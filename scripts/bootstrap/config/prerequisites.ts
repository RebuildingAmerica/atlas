import type { CapabilityId, CommandGroup } from "../lib/types.js";

export interface AuthSpec {
  checkCommand: string;
  loginCommand: string;
  interactive?: boolean;
}

export interface CapabilityConfig {
  id: CapabilityId;
  label: string;
  category: "core" | "deploy" | "product";
  requiredFor: CommandGroup[];
  requiredByDefault: boolean;
  binaryCommand: string;
  versionCommand?: string;
  minVersion?: string;
  versionPrefix?: string;
  installCommands: { macos: string[]; linux: string[] };
  pathCandidates?: string[];
  auth?: AuthSpec;
  postInstallHint?: string;
}

export const CAPABILITY_SPECS: CapabilityConfig[] = [
  {
    id: "core-node",
    label: "Node.js",
    category: "core",
    requiredFor: ["dev", "test", "build", "deploy"],
    requiredByDefault: true,
    binaryCommand: "command -v node",
    versionCommand: "node --version",
    minVersion: "24.0.0",
    installCommands: {
      macos: ["brew install node@24"],
      linux: ["curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -", "sudo apt-get install -y nodejs"],
    },
  },
  {
    id: "core-pnpm",
    label: "pnpm",
    category: "core",
    requiredFor: ["dev", "test", "build", "deploy"],
    requiredByDefault: true,
    binaryCommand: "command -v pnpm",
    versionCommand: "pnpm --version",
    minVersion: "10.0.0",
    installCommands: {
      macos: ["corepack enable", "corepack prepare pnpm@10.33.0 --activate"],
      linux: ["corepack enable", "corepack prepare pnpm@10.33.0 --activate"],
    },
  },
  {
    id: "core-python",
    label: "Python",
    category: "core",
    requiredFor: ["dev", "test"],
    requiredByDefault: true,
    binaryCommand: "command -v python3",
    versionCommand: "python3 --version",
    minVersion: "3.12.0",
    versionPrefix: "Python ",
    installCommands: {
      macos: ["brew install python@3.12"],
      linux: ["sudo apt-get install -y python3.12"],
    },
  },
  {
    id: "core-uv",
    label: "uv",
    category: "core",
    requiredFor: ["dev", "test"],
    requiredByDefault: true,
    binaryCommand: "command -v uv",
    installCommands: {
      macos: ["curl -LsSf https://astral.sh/uv/install.sh | sh"],
      linux: ["curl -LsSf https://astral.sh/uv/install.sh | sh"],
    },
    postInstallHint: "You may need to restart your shell or run: source $HOME/.local/bin/env",
  },
  {
    id: "core-docker",
    label: "Docker",
    category: "deploy",
    requiredFor: ["deploy"],
    requiredByDefault: false,
    binaryCommand: "command -v docker",
    installCommands: {
      macos: ["brew install --cask docker"],
      linux: ["curl -fsSL https://get.docker.com | sh"],
    },
    postInstallHint: "Make sure Docker Desktop is running.",
  },
  {
    id: "deploy-gcloud",
    label: "Google Cloud SDK",
    category: "deploy",
    requiredFor: ["deploy"],
    requiredByDefault: false,
    binaryCommand: "command -v gcloud",
    installCommands: {
      macos: ["brew install --cask google-cloud-sdk"],
      linux: ["curl https://sdk.cloud.google.com | bash"],
    },
    auth: {
      checkCommand: "gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -1 | grep -q .",
      loginCommand: "gcloud auth login",
      interactive: true,
    },
  },
  {
    id: "deploy-gh",
    label: "GitHub CLI",
    category: "deploy",
    requiredFor: ["deploy"],
    requiredByDefault: false,
    binaryCommand: "command -v gh",
    installCommands: {
      macos: ["brew install gh"],
      linux: ["sudo apt-get install -y gh"],
    },
    auth: {
      checkCommand: "gh auth status 2>/dev/null",
      loginCommand: "gh auth login",
      interactive: true,
    },
  },
  {
    id: "deploy-wrangler",
    label: "Cloudflare Wrangler",
    category: "deploy",
    requiredFor: [],
    requiredByDefault: false,
    binaryCommand: "command -v wrangler",
    installCommands: {
      macos: ["pnpm add -g wrangler"],
      linux: ["pnpm add -g wrangler"],
    },
    auth: {
      checkCommand: "wrangler whoami 2>/dev/null | grep -q 'You are logged in'",
      loginCommand: "wrangler login",
      interactive: true,
    },
  },
  {
    id: "product-stripe",
    label: "Stripe CLI",
    category: "product",
    requiredFor: ["product"],
    requiredByDefault: false,
    binaryCommand: "command -v stripe",
    installCommands: {
      macos: ["brew install stripe/stripe-cli/stripe"],
      linux: ["curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg && echo 'deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main' | sudo tee /etc/apt/sources.list.d/stripe.list && sudo apt update && sudo apt install stripe"],
    },
    auth: {
      checkCommand: "stripe get /v1/account 2>/dev/null | grep -q 'id'",
      loginCommand: "stripe login",
      interactive: true,
    },
  },
  {
    id: "product-neonctl",
    label: "Neon CLI",
    category: "product",
    requiredFor: ["product"],
    requiredByDefault: false,
    binaryCommand: "command -v neonctl",
    installCommands: {
      macos: ["brew install neonctl"],
      linux: ["pnpm add -g neonctl"],
    },
    auth: {
      checkCommand: "neonctl me 2>/dev/null | grep -q 'email'",
      loginCommand: "neonctl auth",
      interactive: true,
    },
  },
  {
    id: "product-psql",
    label: "PostgreSQL client",
    category: "product",
    requiredFor: [],
    requiredByDefault: false,
    binaryCommand: "command -v psql",
    installCommands: {
      macos: ["brew install libpq"],
      linux: ["sudo apt-get install -y postgresql-client"],
    },
    pathCandidates: ["/opt/homebrew/opt/libpq/bin/psql", "/usr/local/opt/libpq/bin/psql"],
  },
];

export const COMMAND_CAPABILITY_MAP: Record<CommandGroup, CapabilityId[]> = {
  dev: ["core-node", "core-pnpm", "core-python", "core-uv"],
  test: ["core-node", "core-pnpm", "core-python", "core-uv"],
  build: ["core-node", "core-pnpm"],
  deploy: ["core-node", "core-pnpm", "core-docker", "deploy-gcloud", "deploy-gh"],
  product: ["product-stripe"],
};
