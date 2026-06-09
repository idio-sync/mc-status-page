This is a simple Minecraft server status page that can show a number of servers and their info via cards, each with buttons for two maps that either display in-page or go fullscreen. Configuration is done via the index.html. Pulls stats from the minecraft server itself along with the Crafty Controller API.

Install:
1. Install dependacies: `npm install express minecraft-server-util cors dotenv node-fetch`
2. Configure your environment variables: copy `.env.example` to `.env` and fill in your values:
- `PORT=3000`
- `FRONTEND_URL=your_frontend_url_here`
- `CRAFTY_API_KEY=crafty_api_here`
- `CRAFTY_API_URL=crafty_url_here`

   (`.env` is gitignored so your real credentials are never committed.)
4. Configure your servers: copy `public/servers.example.json` to `public/servers.json` and edit it (an array of server objects: `name`, `domain`, optional `port` (default 25565), `craftyId`, `image`, and `maps.dynmap` / `maps.bluemap`). No HTML editing required. (`public/servers.json` is gitignored.)

Install using Docker:
1. `docker pull idiosync000/mc-status-page`
2. Pass through port 80 and /app/public/
3. Place your `index.html`, `servers.json` (copied from `servers.example.json`), and images in the `public` folder passed through on the host

![ServerStatus](https://raw.githubusercontent.com/idio-sync/mc-status-page/refs/heads/main/screenshot.png)
