const dial = require("@patrickkfkan/peer-dial");
const express = require('express');
const app = express();
const PORT = 8085;
const apps = {
    "YouTube": {
        name: "YouTube",
        state: "stopped",
        allowStop: true,
        pid: null,
        launch(launchData) {
            const tbPackageId = tizen.application.getAppInfo().packageId;
            tizen.application.launchAppControl(
                new tizen.ApplicationControl(
                    "http://tizen.org/appcontrol/operation/view",
                    null,
                    null,
                    null,
                    [
                        new tizen.ApplicationControlData("module", [JSON.stringify(
                            {
                                moduleName: '@foxreis/tizentube',
                                moduleType: 'npm',
                                args: launchData
                            }
                        )])
                    ]
                ), `${tbPackageId}.TizenBrewStandalone`);
        }
    }
};

const dialServer = new dial.Server({
    expressApp: app,
    port: PORT,
    prefix: "/dial",
    manufacturer: 'Reis Can',
    modelName: 'TizenBrew',
    friendlyName: 'TizenTube',
    delegate: {
        getApp(appName) {
            return apps[appName];
        },
        launchApp(appName, launchData, callback) {
            console.log(`Got request to launch ${appName} with launch data: ${launchData}`);
            const app = apps[appName];
            if (app) {
                app.pid = "run";
                app.state = "starting";
                app.launch(launchData);
                app.state = "running";
            }
            callback(app.pid);
        },
        stopApp(appName, pid, callback) {
            console.log(`Got request to stop ${appName} with pid: ${pid}`);
            const app = apps[appName];
            if (app && app.pid === pid) {
                app.pid = null;
                app.state = "stopped";
                callback(true);
            } else {
                callback(false);
            }
        }
    }
});

app.listen(PORT, () => {
    dialServer.start();
});