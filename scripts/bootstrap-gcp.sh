#!/usr/bin/env bash
# bootstrap-gcp.sh — Interactive setup for Atlas deployment on Google Cloud Run.
#
# Configures: GCP project, Artifact Registry, service account, Workload Identity
# Federation, Neon database, and GitHub repository secrets.
#
# Safe to re-run (idempotent).
set -euo pipefail

# ─── Colors & Helpers ────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "${BLUE}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✗${RESET} $*" >&2; }
header()  { echo -e "\n${BOLD}═══ $* ═══${RESET}\n"; }

confirm() {
  local prompt="${1:-Continue?}"
  echo -en "${YELLOW}? ${prompt} [Y/n]${RESET} "
  read -r answer
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
}

prompt_value() {
  local prompt="$1"
  local default="${2:-}"
  if [[ -n "$default" ]]; then
    echo -en "${YELLOW}? ${prompt} [${default}]:${RESET} "
  else
    echo -en "${YELLOW}? ${prompt}:${RESET} "
  fi
  read -r value
  echo "${value:-$default}"
}

# ─── Prerequisites ───────────────────────────────────────────────────────────

header "Prerequisites Check"

check_command() {
  if command -v "$1" &>/dev/null; then
    success "$1 found: $(command -v "$1")"
    return 0
  else
    error "$1 not found. Please install it first."
    return 1
  fi
}

MISSING=0
check_command gcloud || MISSING=1
check_command gh || MISSING=1
check_command psql || warn "psql not found — database validation will be skipped"

if [[ $MISSING -eq 1 ]]; then
  error "Missing required tools. Install them and re-run."
  exit 1
fi

# Verify authentication
info "Checking gcloud authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -1 | grep -q .; then
  error "Not authenticated with gcloud. Run: gcloud auth login"
  exit 1
fi
success "gcloud authenticated as $(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -1)"

info "Checking gh authentication..."
if ! gh auth status &>/dev/null; then
  error "Not authenticated with gh. Run: gh auth login"
  exit 1
fi
success "gh authenticated"

# Detect current repo
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)
if [[ -z "$REPO" ]]; then
  error "Could not detect GitHub repo. Run this from the atlas repo root."
  exit 1
fi
success "GitHub repo: $REPO"

# ─── GCP Project ─────────────────────────────────────────────────────────────

header "GCP Project Setup"

info "Current GCP projects:"
gcloud projects list --format="table(projectId, name)" 2>/dev/null | head -10

echo ""
PROJECT_ID=$(prompt_value "Enter GCP project ID (existing or new)")

if gcloud projects describe "$PROJECT_ID" &>/dev/null; then
  success "Project '$PROJECT_ID' exists"
else
  if confirm "Project '$PROJECT_ID' does not exist. Create it?"; then
    gcloud projects create "$PROJECT_ID"
    success "Project created"
  else
    error "Cannot proceed without a project."
    exit 1
  fi
fi

gcloud config set project "$PROJECT_ID" --quiet
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
success "Active project: $PROJECT_ID (number: $PROJECT_NUMBER)"

# Billing check
info "Checking billing..."
BILLING_ACCOUNT=$(gcloud billing projects describe "$PROJECT_ID" --format="value(billingAccountName)" 2>/dev/null || true)
if [[ -z "$BILLING_ACCOUNT" || "$BILLING_ACCOUNT" == "billingAccountName: ''" ]]; then
  warn "No billing account linked to this project."
  warn "Cloud Run requires billing. Link one at: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID"
  if ! confirm "Is billing now enabled?"; then
    error "Cannot proceed without billing."
    exit 1
  fi
else
  success "Billing enabled"
fi

# ─── Enable APIs ─────────────────────────────────────────────────────────────

header "Enabling GCP APIs"

APIS=(
  run.googleapis.com
  artifactregistry.googleapis.com
  iam.googleapis.com
  iamcredentials.googleapis.com
)

for api in "${APIS[@]}"; do
  info "Enabling $api..."
  gcloud services enable "$api" --quiet
done
success "All required APIs enabled"

# ─── Region Selection ────────────────────────────────────────────────────────

REGION=$(prompt_value "GCP region for Cloud Run & Artifact Registry" "us-central1")
success "Region: $REGION"

# ─── Artifact Registry ───────────────────────────────────────────────────────

header "Artifact Registry"

REPO_NAME="atlas-images"

if gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" &>/dev/null; then
  success "Repository '$REPO_NAME' already exists"
else
  info "Creating Docker repository '$REPO_NAME'..."
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Atlas container images" \
    --quiet
  success "Repository created"
fi

# ─── Service Account ─────────────────────────────────────────────────────────

header "Service Account"

SA_NAME="atlas-deploy"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SA_EMAIL" &>/dev/null; then
  success "Service account '$SA_EMAIL' already exists"
else
  info "Creating service account..."
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Atlas CI/CD Deploy" \
    --quiet
  success "Service account created"
fi

info "Granting IAM roles..."
ROLES=(
  roles/run.admin
  roles/artifactregistry.writer
  roles/iam.serviceAccountUser
)

for role in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --condition=None \
    --quiet &>/dev/null
done
success "Roles granted: ${ROLES[*]}"

# ─── Workload Identity Federation ────────────────────────────────────────────

header "Workload Identity Federation (GitHub → GCP)"

POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"

# Create pool
if gcloud iam workload-identity-pools describe "$POOL_NAME" --location=global &>/dev/null; then
  success "Pool '$POOL_NAME' already exists"
else
  info "Creating workload identity pool..."
  gcloud iam workload-identity-pools create "$POOL_NAME" \
    --location=global \
    --display-name="GitHub Actions" \
    --quiet
  success "Pool created"
fi

# Create OIDC provider
PROVIDER_FULL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"

if gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
    --workload-identity-pool="$POOL_NAME" \
    --location=global &>/dev/null; then
  success "Provider '$PROVIDER_NAME' already exists"
else
  info "Creating OIDC provider..."
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
    --workload-identity-pool="$POOL_NAME" \
    --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository == '${REPO}'" \
    --quiet
  success "Provider created"
fi

# Bind service account
info "Binding service account to workload identity pool..."
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${REPO}" \
  --quiet &>/dev/null
success "Service account bound to pool"

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"
info "WIF Provider: $WIF_PROVIDER"

# ─── Neon Database ───────────────────────────────────────────────────────────

header "Neon PostgreSQL Database"

info "Atlas needs a PostgreSQL database. Create one at https://neon.tech"
echo ""
DATABASE_URL=$(prompt_value "Neon connection string (postgresql://...)")

if [[ ! "$DATABASE_URL" =~ ^postgres ]]; then
  error "Invalid connection string. Must start with postgresql:// or postgres://"
  exit 1
fi

# Validate connection
if command -v psql &>/dev/null; then
  info "Validating database connection..."
  if psql "$DATABASE_URL" -c "SELECT 1" &>/dev/null; then
    success "Database connection successful"

    # Run schema migration
    SCHEMA_FILE="$(cd "$(dirname "$0")/.." && pwd)/api/atlas/models/schema.sql"
    if [[ -f "$SCHEMA_FILE" ]]; then
      if confirm "Run schema migration ($SCHEMA_FILE)?"; then
        psql "$DATABASE_URL" -f "$SCHEMA_FILE"
        success "Schema migration complete"
      fi
    else
      warn "Schema file not found at $SCHEMA_FILE — run migration manually"
    fi
  else
    warn "Could not connect to database. Continuing anyway."
  fi
fi

# ─── Application Secrets ─────────────────────────────────────────────────────

header "Application Secrets"

info "These secrets are needed for the deployed services."
echo ""

ATLAS_PUBLIC_URL=$(prompt_value "Public URL" "https://atlas.rebuildingus.org")
ANTHROPIC_API_KEY=$(prompt_value "Anthropic API key")
ATLAS_AUTH_INTERNAL_SECRET=$(prompt_value "Auth internal secret (leave blank to auto-generate)")

if [[ -z "$ATLAS_AUTH_INTERNAL_SECRET" ]]; then
  ATLAS_AUTH_INTERNAL_SECRET=$(openssl rand -base64 32)
  success "Generated auth internal secret"
fi

ATLAS_AUTH_ALLOWED_EMAILS=$(prompt_value "Allowed emails (comma-separated)")
ATLAS_EMAIL_RESEND_API_KEY=$(prompt_value "Resend API key (for email delivery)" "")

# ─── GitHub Secrets ──────────────────────────────────────────────────────────

header "GitHub Repository Secrets"

if confirm "Set GitHub secrets for ${REPO}?"; then
  info "Setting secrets..."

  gh secret set GCP_PROJECT_ID --body "$PROJECT_ID"
  gh secret set GCP_REGION --body "$REGION"
  gh secret set GCP_SERVICE_ACCOUNT --body "$SA_EMAIL"
  gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --body "$WIF_PROVIDER"
  gh secret set DATABASE_URL --body "$DATABASE_URL"
  gh secret set ATLAS_PUBLIC_URL --body "$ATLAS_PUBLIC_URL"
  gh secret set ANTHROPIC_API_KEY --body "$ANTHROPIC_API_KEY"
  gh secret set ATLAS_AUTH_INTERNAL_SECRET --body "$ATLAS_AUTH_INTERNAL_SECRET"
  gh secret set ATLAS_AUTH_ALLOWED_EMAILS --body "$ATLAS_AUTH_ALLOWED_EMAILS"

  if [[ -n "$ATLAS_EMAIL_RESEND_API_KEY" ]]; then
    gh secret set ATLAS_EMAIL_RESEND_API_KEY --body "$ATLAS_EMAIL_RESEND_API_KEY"
  fi

  success "All GitHub secrets configured"
else
  warn "Skipped GitHub secrets. Set them manually before deploying."
fi

# ─── Initial Deploy (Optional) ──────────────────────────────────────────────

header "Initial Deployment"

if confirm "Deploy services to Cloud Run now?"; then
  IMAGE_BASE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"

  info "Configuring Docker for Artifact Registry..."
  gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

  info "Building atlas-api..."
  docker build -t "${IMAGE_BASE}/atlas-api:initial" ./api
  docker push "${IMAGE_BASE}/atlas-api:initial"
  success "atlas-api image pushed"

  info "Building atlas-web..."
  docker build -t "${IMAGE_BASE}/atlas-web:initial" ./app
  docker push "${IMAGE_BASE}/atlas-web:initial"
  success "atlas-web image pushed"

  # Write env files to avoid comma-delimiter issues in --set-env-vars
  API_ENV_FILE=$(mktemp)
  cat > "$API_ENV_FILE" <<ENVEOF
ENVIRONMENT=production
LOG_LEVEL=info
DATABASE_URL=${DATABASE_URL}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ATLAS_AUTH_INTERNAL_SECRET=${ATLAS_AUTH_INTERNAL_SECRET}
ATLAS_PUBLIC_URL=${ATLAS_PUBLIC_URL}
ENVEOF

  info "Deploying atlas-api (internal)..."
  gcloud run deploy atlas-api \
    --image="${IMAGE_BASE}/atlas-api:initial" \
    --region="$REGION" \
    --platform=managed \
    --ingress=internal \
    --allow-unauthenticated \
    --min-instances=0 \
    --max-instances=2 \
    --memory=512Mi \
    --cpu=1 \
    --port=8000 \
    --env-vars-file="$API_ENV_FILE" \
    --quiet
  rm -f "$API_ENV_FILE"

  API_URL=$(gcloud run services describe atlas-api --region="$REGION" --format='value(status.url)')
  success "atlas-api deployed at: $API_URL"

  WEB_ENV_FILE=$(mktemp)
  cat > "$WEB_ENV_FILE" <<ENVEOF
ATLAS_PUBLIC_URL=${ATLAS_PUBLIC_URL}
ATLAS_AUTH_BASE_PATH=/api/auth
ATLAS_SERVER_API_PROXY_TARGET=${API_URL}
DATABASE_URL=${DATABASE_URL}
ATLAS_AUTH_INTERNAL_SECRET=${ATLAS_AUTH_INTERNAL_SECRET}
ATLAS_AUTH_ALLOWED_EMAILS=${ATLAS_AUTH_ALLOWED_EMAILS}
ENVEOF

  info "Deploying atlas-web (public)..."
  gcloud run deploy atlas-web \
    --image="${IMAGE_BASE}/atlas-web:initial" \
    --region="$REGION" \
    --platform=managed \
    --allow-unauthenticated \
    --min-instances=0 \
    --max-instances=2 \
    --memory=512Mi \
    --cpu=1 \
    --port=3000 \
    --env-vars-file="$WEB_ENV_FILE" \
    --quiet
  rm -f "$WEB_ENV_FILE"

  WEB_URL=$(gcloud run services describe atlas-web --region="$REGION" --format='value(status.url)')
  success "atlas-web deployed at: $WEB_URL"

  # Custom domain mapping
  if confirm "Map custom domain (${ATLAS_PUBLIC_URL#https://}) to atlas-web?"; then
    DOMAIN="${ATLAS_PUBLIC_URL#https://}"
    gcloud run domain-mappings create \
      --service=atlas-web \
      --domain="$DOMAIN" \
      --region="$REGION" \
      --quiet 2>/dev/null || warn "Domain mapping may already exist or require DNS verification"

    # Cloudflare DNS auto-configuration
    if command -v wrangler &>/dev/null; then
      if confirm "Configure DNS via Cloudflare (wrangler)?"; then
        info "Detecting Cloudflare zone for ${DOMAIN}..."
        # Extract the root domain (e.g., rebuildingus.org from atlas.rebuildingus.org)
        ROOT_DOMAIN=$(echo "$DOMAIN" | awk -F. '{print $(NF-1)"."$NF}')
        SUBDOMAIN=$(echo "$DOMAIN" | sed "s/\.${ROOT_DOMAIN}$//")

        ZONE_ID=$(wrangler dns list-zones 2>/dev/null | grep "$ROOT_DOMAIN" | awk '{print $1}')
        if [[ -n "$ZONE_ID" ]]; then
          success "Found Cloudflare zone: $ROOT_DOMAIN ($ZONE_ID)"

          # Check if record already exists
          EXISTING=$(wrangler dns list "$ZONE_ID" --name="$DOMAIN" 2>/dev/null | grep CNAME || true)
          if [[ -n "$EXISTING" ]]; then
            warn "DNS record already exists for $DOMAIN — skipping"
          else
            info "Creating CNAME record: ${DOMAIN} → ghs.googlehosted.com"
            wrangler dns create "$ZONE_ID" \
              --type=CNAME \
              --name="$SUBDOMAIN" \
              --content="ghs.googlehosted.com" \
              --proxied=false \
              2>/dev/null && success "Cloudflare DNS record created" \
              || warn "Failed to create DNS record — add manually"
          fi
        else
          warn "Could not find Cloudflare zone for $ROOT_DOMAIN"
          info "Add this DNS record manually:"
          echo -e "  ${BOLD}Type:${RESET}  CNAME"
          echo -e "  ${BOLD}Name:${RESET}  ${SUBDOMAIN}"
          echo -e "  ${BOLD}Value:${RESET} ghs.googlehosted.com."
          echo ""
        fi
      fi
    else
      echo ""
      info "Add this DNS record to your domain:"
      echo -e "  ${BOLD}Type:${RESET}  CNAME"
      echo -e "  ${BOLD}Name:${RESET}  ${DOMAIN}"
      echo -e "  ${BOLD}Value:${RESET} ghs.googlehosted.com."
      echo -e "\n  ${BLUE}Tip:${RESET} Install wrangler (npm i -g wrangler) to auto-configure Cloudflare DNS."
      echo ""
    fi
  fi
else
  info "Skipped initial deploy. Push to main to trigger automated deployment."
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

header "Setup Complete"

echo -e "${GREEN}${BOLD}Atlas deployment pipeline is configured!${RESET}"
echo ""
echo "  GCP Project:    $PROJECT_ID"
echo "  Region:         $REGION"
echo "  Registry:       ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
echo "  Service Acct:   $SA_EMAIL"
echo "  WIF Provider:   $WIF_PROVIDER"
echo "  Database:       Neon PostgreSQL (configured)"
echo "  GitHub Repo:    $REPO"
echo ""
echo -e "${BOLD}Next steps:${RESET}"
echo "  1. Push to 'main' branch to trigger automated deployment"
echo "  2. Verify at: $ATLAS_PUBLIC_URL"
echo ""
