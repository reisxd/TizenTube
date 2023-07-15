# TizenTube
A NodeJS script to remove YouTube ads and add support for Sponsorblock for your Tizen TV (2017 and forward).

# How does it work?
It first connects to the TV by using SDB (Smart Development Bridge) and starts an app that launches YouTube in debugging mode. After it has launched, the script connects to the debugger and sends JS code to the debugger that removes video ads.

# How can I install this?
You'll need:
* A PC that can run Tizen Studio
* A PC/Single Board Computer that could run this 24/7 (for ease of use)/The Android App
* Time

You have to first enable "Developer Mode". This is very easy to do and you can follow [this](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html).

Second, install Tizen Studio. You can follow the guide [here](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html). To know what version of the SDK to install, check your TVs release year and [see which SDK version is recommended](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups.html).

After installing, connect to your TV using this [guide](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html#:~:text=Connect%20the%20TV%20to%20the%20SDK%3A).

After connecting to your TV, create a Samsung certificate using this [guide](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html).

After all that, clone/download the repository and open the `apps/` folder in Tizen Studio by restarting Tizen Studio and changing the workspace. 

Now, all you have to do is select one of the app at a time and press the run button.

Note that you have to change the IP in the launcher. Open up Launcher/index.html in Tizen Studio and change the IP variable.

And after all that, installing apps is complete! Now comes the easier part, installing the server.

If you want to install it on your PC/SBC, follow these steps:

* Download [NodeJS](https://nodejs.org) if you haven't

* Clone the repository

* Install modules by running `npm i`

* Install mods modules by running `cd mods/ && npm i`

* Build mods by running `npm run build`

* Edit the config.json file to your needs

* Run `cd .. && node .`

And now you should have a server running!

If you want to go easy route and use the Android app:

* First, change the Developer Mode's Host IP to your device's IP.

* Download the latest APK compatible with your device's architecute from [here](https://github.com/reisxd/TizenTube/releases/latest) (if unsure, download armeabi-v7a)

* Install it

* After opening the app, change the configuration to your needs

* Press 'Run Server'

* Press 'Launch' whenever you want to launch TizenTube

And now you can launch TizenTube from your Android device!

Please note that if the app crashes, you _probably_ did something wrong. Like setting the wrong IP or not changing the Developer Mode's Host IP.