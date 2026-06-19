# Single image shared by the API and the worker.
# FFmpeg is installed here so the worker can transcode (the API doesn't need it,
# but sharing one image keeps things simple).
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

# Default command; docker-compose overrides it per service (api vs worker).
CMD ["npm", "run", "api"]
