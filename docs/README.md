# TizenTube Installation Guide

To install TizenTube on your Samsung TV or a TV running Tizen, the TV must be running Tizen 3 (2017) or later.

There are two versions of TizenTube available for installation, one for newer Tizen TVs (Tizen 6 and later) and one for older.

## Installation

### Using Apps2Samsung

1. Download the latest release of Apps2Samsung from [here](https://github.com/Apps2Samsung/Apps2Samsung/releases).
2. Install it on your computer or Android phone.
3. Before running Apps2Samsung, set the Host PC IP Address to your PCs or phones IP:
    - Open **Apps** or **App Settings** on your Samsung TV.
    - In the **Apps** panel, enter `12345` using your remote control or the on-screen keypad.
    - A *Developer Mode* configuration popup will appear:
        - Switch **Developer mode** to **On**.
        - Under **Host PC IP**, enter your PCs or phones IP (note that it must be in reverse if your TV is in a right to left language, like Arabic. I.e. `192.168.1.5` becomes `5.1.168.192`)
    - Click **OK**.
    - Reboot your TV by holding the power button on your remote until you see the startup logo.
4. Open Apps2Samsung and select your TV from the list of available devices. If your TV is not listed, enter your TV's IP address manually.
5. Select "TizenTube" as the release. Note that there are three versions:
    - **TizenTubeCobalt.wgt**: For Tizen 6 (2021) and later (newer TVs)
    - **TizenTubeCobaltTizenTubeProxyAddress.wgt**: For Tizen 6 (2021) and later (newer TVs) with the TizenTube proxy server address set to `http://tizentube:8101` in config.xml. This is for TVs that have issues with the default proxy address. To use this, your DNS must resolve `tizentube` to your TV's IP address. You can do this by adding a DNS entry in your router or using a DNS service that allows custom entries. Note that the IP must be static as it can change.
    - **TizenTubeOld.wgt**: For Tizen 3, 4, 5 and 5.5 (older TVs)
6. In Apps2Samsung, click the settings icon (gear) and:
    - On PC, enable "Force Samsung Certificate" and "Partner Signing".
    - On Android, scroll down to "Certificate", click on it, and select the certificate type as Partner and enable "Force Samsung Certificate".
7. In the Relase dropdown, scroll down until you see "Custom WGT File" and select the file you downloaded in step 5.
8. Click **Install** and wait for the installation to complete. You should see a success message once the installation is finished.
9. If you're on an older Tizen version, you may need to set the developer mode Host PC IP to `127.0.0.1` and reboot your TV after installation. Otherwise there could be playback issues.

## Troubleshooting

If you've installed TizenTube Cobalt and you get "A network error has occured" while launching the app, it means that your TV is unable to connect to the TizenTube proxy server. This could happen because:
- You didn't enable "Force Samsung Certificate" and "Partner Signing" in Apps2Samsung while installing TizenTube Cobalt.
- Your TV is unable to resolve the default proxy server address `http://127.0.0.2:8101`. In this case, you can try using the TizenTubeCobaltTizenTubeProxyAddress.wgt version of TizenTube Cobalt, which uses `http://tizentube:8101` as the proxy server address. Make sure that your DNS resolves `tizentube` to your TV's IP address. You can do this by adding a DNS entry in your router or using a DNS service that allows custom entries. Note that the IP must be static as it can change.
- Your TV is running Tizen 5.5 or earlier, which doesn't support TizenTube Cobalt. In this case, you can try using the TizenTubeOld.wgt version of TizenTube, which is compatible with older Tizen versions.
- You're not connected to the internet.
- In the case of a cold boot, the TizenTube proxy server may take a few seconds to start. Wait for a few seconds and try again.