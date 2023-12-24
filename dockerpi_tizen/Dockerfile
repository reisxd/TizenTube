FROM arm32v7/node

WORKDIR /app

COPY requirements.txt ./
COPY /TizenTube/ ./
WORKDIR /app
RUN npm i
WORKDIR /app/mods
RUN npm i
RUN npm run build
WORKDIR /app