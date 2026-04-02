FROM node:18

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm install

COPY . .

EXPOSE 5000

CMD ["node", "backend/server.js"]
