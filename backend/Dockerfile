FROM node:20-slim

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .

RUN mkdir -p /app/data
EXPOSE 4000
CMD ["node", "src/index.js"]
