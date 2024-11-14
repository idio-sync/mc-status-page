# Dockerfile
FROM node:18-alpine

# Install nginx
RUN apk add --no-cache nginx

# Create app directory
WORKDIR /app

# Install backend dependencies
COPY package*.json ./
RUN npm install

# Copy backend source
COPY server.js .
COPY .env .

# Copy frontend files
COPY public /app/public

# Configure nginx
COPY nginx.conf /etc/nginx/http.d/default.conf

# Expose port
EXPOSE 80

# Start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

CMD ["/app/start.sh"]
