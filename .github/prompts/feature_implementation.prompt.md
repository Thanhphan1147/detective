---
mode: agent
---
Rules:
1. Everything is done in the multipass VM. Do not make any changes to the host machine. Interact with the VM using `multipass exec dev -- <command>`.
2. To build the project, run `npm run build` inside the VM.
3. To restart the service, run `sudo systemctl restart detective.service` inside the VM
4. Test the service using the chrome MCP server, fetch the multipass IP address using `multipass list` and open `http://<MULTIPASS_IP_ADDRESS>:3000` in the browser.
