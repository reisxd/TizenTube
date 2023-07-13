# TizenTube
A NodeJS script to remove YouTube ads from your Tizen TV (2017 and forward).

# How does it work?
It first connects to the TV by using SDB (Smart Development Bridge) and starts an app that launches YouTube in debugging mode. After it has launched, the script connects to the debugger and sends JS code to the debugger that removes video ads.

# How can I install this?
You'll need:
* A PC that can run Tizen Studio
* A PC/Single Board Computer that could run this 24/7 (for ease of use)
* Time

You have to first enable "Developer Mode". This is very easy to do and you can follow [this](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).


You have to install the apps located in the `apps/` folder (you technically don't need the launcher but it is recommended) using Tizen Studio. After that, launch the server using `node .` and launch the launcher app or go to `http://127.0.0.1:3000/launch` on your browser.