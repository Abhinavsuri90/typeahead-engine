# Stage 1: Build Environment
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY package*.json ./

# Install all dependencies (including devDependencies like typescript)
RUN npm install

# Copy all source code (respects .dockerignore)
COPY . .

# Compile TypeScript to JavaScript in the dist/ folder
RUN npm run build

# Stage 2: Production Environment
FROM node:18-alpine AS production

WORKDIR /usr/src/app

# Set Node environment to production for optimizations
ENV NODE_ENV=production

# Copy package files again
COPY package*.json ./

# Install ONLY production dependencies (reduces image size significantly)
RUN npm install --omit=dev

# Copy the compiled JS from the builder stage
COPY --from=builder /usr/src/app/dist ./dist
# Copy the frontend UI so it can be served
COPY --from=builder /usr/src/app/client ./client

# Expose the port the app runs on (configurable via build arg)
ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}

# Start the application
CMD ["npm", "start"]
