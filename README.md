This is a simple Minecraft server status page that can show a number of servers and their info via cards, each with buttons for two maps that either display in-page or go fullscreen. Configuration is done via the index.html.

Install:
- Install dependacies: `npm install express minecraft-server-util cors dotenv`
- Configure your environment variables, create a .env file with: 
`PORT=3000
FRONTEND_URL=your_frontend_url_here`
- Edit the servers array in the frontend code to add your Minecraft servers

Docker:
- `docker pull idiosync000/mc-status-page`
- Pass through port 80 and /app/public/
- Place exited index.html and images in `public` folder passed through on host

![ServerStatus](https://raw.githubusercontent.com/idio-sync/mc-status-page/refs/heads/main/screenshot.png)
