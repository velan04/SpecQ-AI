# ── Stage: Python 3.11 + Node.js 20 + Chromium (for Puppeteer) ────────────────
FROM python:3.11-slim

# System deps + Chromium + Node.js 20 + .NET 6 SDK
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg ca-certificates wget \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install .NET 6 SDK via official install script (works on any Debian/Ubuntu version)
RUN wget -q https://dot.net/v1/dotnet-install.sh -O /tmp/dotnet-install.sh \
    && chmod +x /tmp/dotnet-install.sh \
    && /tmp/dotnet-install.sh --channel 6.0 --install-dir /usr/share/dotnet \
    && ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet \
    && rm /tmp/dotnet-install.sh

ENV DOTNET_ROOT=/usr/share/dotnet
ENV PATH="${PATH}:/usr/share/dotnet"
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1

# Tell Puppeteer to use system Chromium — skip bundled Chrome download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install Python deps first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy the full server code
COPY . .

EXPOSE 8000

# Railway injects $PORT; fall back to 8000 locally
CMD sh -c "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}"
