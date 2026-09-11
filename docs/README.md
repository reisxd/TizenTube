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
5. Download the latest release of TizenTube from the [here](https://github.com/reisxd/TizenTube/releases/latest). Note that there are two versions:
    - **TizenTubeCobalt.wgt**: For Tizen 6 (2021) and later (newer TVs)
    - **TizenTubeOld.wgt**: For Tizen 3, 4, 5 and 5.5 (older TVs)
6. In Apps2Samsung, click the settings icon (gear) and:
    - On PC, enable "Force Samsung Certificate" and "Partner Signing".
    - On Android, scroll down to "Certificate", click on it, and select the certificate type as Partner and enable "Force Samsung Certificate".
7. In the Relase dropdown, scroll down until you see "Custom WGT File" and select the file you downloaded in step 5.
8. Click **Install** and wait for the installation to complete. You should see a success message once the installation is finished.
9. If you're on an older Tizen version, you may need to set the developer mode Host PC IP to `127.0.0.1` and reboot your TV after installation. Otherwise there could be playback issues.