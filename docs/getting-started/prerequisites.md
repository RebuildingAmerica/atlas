# Prerequisites

[Docs](../README.md) > [Getting Started](./README.md) > Prerequisites

Before you can run The Atlas locally, make sure you have the following installed:

## Required

### Python 3.12+

The backend runs on Python 3.12+.

**macOS (Homebrew):**
```bash
brew install python@3.12
python3.12 --version  # Verify
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install python3.12 python3.12-venv python3.12-dev
python3.12 --version  # Verify
```

**macOS/Linux (pyenv):**
```bash
brew install pyenv          # Or follow pyenv install guide
pyenv install 3.12.0
pyenv local 3.12.0
python --version  # Verify
```

**Windows:**
Download from [python.org](https://www.python.org/downloads/) and run installer, or use Windows Package Manager:
```powershell
winget install Python.Python.3.12
python --version  # Verify
```

### Node.js 20+

The frontend runs on Node.js 20+.

**macOS (Homebrew):**
```bash
brew install node@20
node --version  # Verify (should be v20.x.x)
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # Verify
```

**macOS/Linux (nvm - Node Version Manager):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
node --version  # Verify
```

**Windows:**
Download from [nodejs.org](https://nodejs.org/) or use Windows Package Manager:
```powershell
winget install OpenJS.NodeJS
node --version  # Verify
```

### Make

Build automation tool. Used to run development commands.

**macOS (Homebrew):**
```bash
brew install make
make --version  # Verify
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install make
make --version  # Verify
```

**Windows:**
Install via [MinGW](http://www.mingw.org/) or [GNU Make for Windows](http://gnuwin32.sourceforge.net/packages/make.htm), or use Windows Subsystem for Linux (WSL).

### Git

Version control. You likely have this already.

**macOS:**
```bash
brew install git
git --version  # Verify
```

**Linux:**
```bash
sudo apt-get install git
git --version  # Verify
```

**Windows:**
Download from [git-scm.com](https://git-scm.com/download/win)

## Optional (for Docker development)

### Docker & Docker Compose

If you prefer running services in containers instead of locally.

**macOS:**
Install [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop)

**Linux:**
```bash
sudo apt-get install docker.io docker-compose
sudo usermod -aG docker $USER  # Add user to docker group
```

**Windows:**
Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)

Verify both are installed:
```bash
docker --version
docker compose --version
```

## Verification Checklist

Run these commands to verify everything is installed:

```bash
# Python
python3 --version          # Should be 3.12+

# Node
node --version             # Should be v20+
pnpm --version             # Should be 10+ (enable with `corepack enable`)

# Make
make --version             # Should show version

# Git
git --version              # Should show version

# Optional: Docker
docker --version           # If using Docker
docker compose --version   # If using Docker
```

If all commands return versions without errors, you're ready for [Quick Start](./quick-start.md).

---

## Troubleshooting

### "python3 command not found"
Make sure Python 3.12+ is installed and in your PATH. On macOS with Homebrew, you may need to use `python3.12` instead of `python3`.

### "node command not found"
Make sure Node.js 20+ is installed. If you installed with nvm, run `nvm use 20` first.

### "make command not found"
Install Make (see instructions above). On Windows, consider using WSL or MinGW.

### Permission denied errors on Linux
You may need to use `sudo` for Docker commands, or add your user to the docker group:
```bash
sudo usermod -aG docker $USER
newgrp docker  # Apply group change without logout
```

---

Next: [Quick Start](./quick-start.md)
