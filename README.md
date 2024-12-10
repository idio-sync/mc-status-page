This is a simple Minecraft server status page that can show a number of servers and their info via cards, each with buttons for two maps that either display in-page or go fullscreen. Configuration is done via the index.html. Pulls stats from the minecraft server itself along with the Crafty Controller API.

Install:
1. Install dependacies: `npm install express minecraft-server-util cors dotenv node-fetch`
2. Configure your environment variables, create a .env file with: 
`PORT=3000
FRONTEND_URL=your_frontend_url_here
CRAFTY_API_KEY=crafty_api_here
CRAFTY_API_URL=crafty_url_here`
4. Edit the servers array in the frontend code to add your Minecraft servers

Install using Docker:
1. `docker pull idiosync000/mc-status-page`
2. Pass through port 80 and /app/public/
3. Place exited index.html and images in `public` folder passed through on host

![ServerStatus](https://raw.githubusercontent.com/idio-sync/mc-status-page/refs/heads/main/screenshot.png)
