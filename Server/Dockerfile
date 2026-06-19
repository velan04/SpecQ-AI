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

# Install .NET 6 SDK (Microsoft package feed)
RUN wget -q https://packages.microsoft.com/config/debian/11/packages-microsoft-prod.deb -O /tmp/packages-microsoft-prod.deb \
    && dpkg -i /tmp/packages-microsoft-prod.deb \
    && rm /tmp/packages-microsoft-prod.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends dotnet-sdk-6.0 \
    && rm -rf /var/lib/apt/lists/*

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
