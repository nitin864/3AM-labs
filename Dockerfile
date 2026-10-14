FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .

# The verification gate is intentionally offline and does not start Docker or
# contact a network service. `make test` is the container health check.
CMD ["npm", "test"]
