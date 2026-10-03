FROM node:24-alpine

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY mcp-server/package*.json ./mcp-server/

# Copy common directory (shared dependency)
COPY common/package.json common/tsconfig.json ./common/
COPY common/*.ts ./common/

WORKDIR /app/common
RUN npm install && npm run build

# Set working directory to mcp-server for installation
WORKDIR /app/mcp-server

# Install dependencies
RUN npm install

# Copy mcp-server source code
COPY mcp-server/ ./

# Build mcp-server
RUN npm run build

# Expose MCP HTTP (18790) and extension WebSocket (18789) ports
ENV EXTENSION_PORT=18789
ENV MCP_HTTP_PORT=18790
ENV CONTAINERIZED=true

EXPOSE 18789 18790

# Start the persistent HTTP MCP server
CMD ["node", "dist/http-server.js"]