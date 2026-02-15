# ============================================================
# Agentic Chat — Multi-stage Docker Build
#
# Stage 1: Install dev dependencies and run tests
# Stage 2: Serve static files with nginx (alpine)
#
# Usage:
#   docker build -t agenticchat .
#   docker run -p 8080:80 agenticchat
# ============================================================

# --- Stage 1: Test ---
FROM node:25-alpine AS test

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm test

# --- Stage 2: Production ---
FROM nginx:1.27-alpine AS production

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Custom nginx config with security headers
COPY <<'EOF' /etc/nginx/conf.d/agenticchat.conf
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/javascript application/json;
    gzip_min_length 256;

    # Cache static assets
    location ~* \.(css|js|ico|png|jpg|svg|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Block dotfiles
    location ~ /\. {
        deny all;
        return 404;
    }
}
EOF

# Copy only the static files needed for production
COPY index.html /usr/share/nginx/html/
COPY style.css /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:80/ || exit 1
