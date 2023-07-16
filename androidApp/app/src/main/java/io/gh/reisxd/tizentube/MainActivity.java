package io.gh.reisxd.tizentube;

import androidx.appcompat.app.AppCompatActivity;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.Switch;
import android.widget.TextView;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.URI;
import java.net.URISyntaxException;

public class MainActivity extends AppCompatActivity {

    static {
        System.loadLibrary("tizentube");
        System.loadLibrary("node");
    }

    private WebSocketClient wsClient;
    private boolean isRunning = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        String nodeDir = getApplicationContext().getFilesDir().getAbsolutePath() + "/tizentube";

        if (wasAPKUpdated()) {
            //Recursively delete any existing nodejs-project.
            File nodeDirReference = new File(nodeDir);
            if (nodeDirReference.exists()) {
                backupConfig();

                deleteFolderRecursively(new File(nodeDir));
                copyAssetFolder(getApplicationContext().getAssets(), "tizentube", nodeDir);
                JSONObject backedUpConfig = readConfig(getApplicationContext().getFilesDir().getAbsolutePath() + "/config.json");
                writeConfig(backedUpConfig);
            } else {
                copyAssetFolder(getApplicationContext().getAssets(), "tizentube", nodeDir);
            }

            saveLastUpdateTime();
        }

        JSONObject object = readConfig();
        EditText appIdText = (EditText) findViewById(R.id.appIdTextField);
        EditText tvIpText = (EditText) findViewById(R.id.tvIpTextField);
        Switch isTizen3 = (Switch) findViewById(R.id.isTizen3);
        try {
            appIdText.setText(object.getString("appId"));
            tvIpText.setText(object.getString("tvIP"));
            isTizen3.setChecked(object.getBoolean("isTizen3"));
        } catch (JSONException e) {
            e.printStackTrace();
        }


    }

    public native Integer startNodeWithArguments(String[] arguments);

    // From https://github.com/JaneaSystems/nodejs-mobile-samples/blob/master/android/native-gradle-node-folder/app/src/main/java/com/yourorg/sample/MainActivity.java#L98

    private boolean wasAPKUpdated() {
        SharedPreferences prefs = getApplicationContext().getSharedPreferences("NODEJS_MOBILE_PREFS", Context.MODE_PRIVATE);
        long previousLastUpdateTime = prefs.getLong("NODEJS_MOBILE_APK_LastUpdateTime", 0);
        long lastUpdateTime = 1;
        try {
            PackageInfo packageInfo = getApplicationContext().getPackageManager().getPackageInfo(getApplicationContext().getPackageName(), 0);
            lastUpdateTime = packageInfo.lastUpdateTime;
        } catch (PackageManager.NameNotFoundException e) {
            e.printStackTrace();
        }
        return (lastUpdateTime != previousLastUpdateTime);
    }

    private void saveLastUpdateTime() {
        long lastUpdateTime = 1;
        try {
            PackageInfo packageInfo = getApplicationContext().getPackageManager().getPackageInfo(getApplicationContext().getPackageName(), 0);
            lastUpdateTime = packageInfo.lastUpdateTime;
        } catch (PackageManager.NameNotFoundException e) {
            e.printStackTrace();
        }
        SharedPreferences prefs = getApplicationContext().getSharedPreferences("NODEJS_MOBILE_PREFS", Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        editor.putLong("NODEJS_MOBILE_APK_LastUpdateTime", lastUpdateTime);
        editor.commit();
    }

    private static boolean deleteFolderRecursively(File file) {
        try {
            boolean res=true;
            for (File childFile : file.listFiles()) {
                if (childFile.isDirectory()) {
                    res &= deleteFolderRecursively(childFile);
                } else {
                    res &= childFile.delete();
                }
            }
            res &= file.delete();
            return res;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    private static boolean copyAssetFolder(AssetManager assetManager, String fromAssetPath, String toPath) {
        try {
            String[] files = assetManager.list(fromAssetPath);
            boolean res = true;

            if (files.length==0) {
                //If it's a file, it won't have any assets "inside" it.
                res &= copyAsset(assetManager,
                        fromAssetPath,
                        toPath);
            } else {
                new File(toPath).mkdirs();
                for (String file : files)
                    res &= copyAssetFolder(assetManager,
                            fromAssetPath + "/" + file,
                            toPath + "/" + file);
            }
            return res;
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    private static boolean copyAsset(AssetManager assetManager, String fromAssetPath, String toPath) {
        InputStream in = null;
        OutputStream out = null;
        try {
            in = assetManager.open(fromAssetPath);
            new File(toPath).createNewFile();
            out = new FileOutputStream(toPath);
            copyFile(in, out);
            in.close();
            in = null;
            out.flush();
            out.close();
            out = null;
            return true;
        } catch(Exception e) {
            e.printStackTrace();
            return false;
        }
    }

    private static void copyFile(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[1024];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
    }

    private JSONObject readConfig(String path) {
        JSONObject configObject = null;
        try {
            FileInputStream fis = new FileInputStream(new File(path));

            InputStreamReader isr = new InputStreamReader(fis);
            BufferedReader bufferedReader = new BufferedReader(isr);
            StringBuilder sb = new StringBuilder();
            String content = "";
            while ((content = bufferedReader.readLine()) != null) {

                sb.append(content);
            }

            fis.close();
            configObject = new JSONObject(sb.toString());
        } catch (JSONException e) {
            e.printStackTrace();
        } catch (FileNotFoundException e) {
            e.printStackTrace();
            try {
                return new JSONObject("{}");
            } catch (JSONException ex) {
                ex.printStackTrace();
            }
        } catch (IOException e) {
            e.printStackTrace();
        }

        return configObject;
    }

    private JSONObject readConfig() {
        return readConfig(getApplicationContext().getFilesDir().getAbsolutePath() + "/tizentube/config.json");
    }

    private void writeConfig(JSONObject object, String path) {
        try {
            String configContent = object.toString();
            FileOutputStream file = new FileOutputStream(new File(path));
            OutputStreamWriter outputStreamWriter = new OutputStreamWriter(file);
            outputStreamWriter.write(configContent);
            outputStreamWriter.close();
        } catch (FileNotFoundException ex) {
            ex.printStackTrace();
        } catch (IOException ex) {
            ex.printStackTrace();
        }
    }

    private void writeConfig(JSONObject object) {
        writeConfig(object, getApplicationContext().getFilesDir().getAbsolutePath() + "/tizentube/config.json");
    }

    public void saveConfig(View v)
    {
        try {
            JSONObject object = readConfig();
            EditText appIdText = (EditText) findViewById(R.id.appIdTextField);
            EditText tvIpText = (EditText) findViewById(R.id.tvIpTextField);
            Switch isTizen3 = (Switch) findViewById(R.id.isTizen3);
            object.put("appId", appIdText.getText());
            object.put("tvIP", tvIpText.getText());
            object.put("isTizen3", isTizen3.isChecked());
            writeConfig(object);
        } catch (JSONException ex) {
            ex.printStackTrace();
        }
    }

    private void backupConfig() {
            JSONObject config = readConfig();
            writeConfig(config, getApplicationContext().getFilesDir().getAbsolutePath() + "/config.json");
    }

    public void runServer(View v) {
        if (!isRunning) {
            isRunning = true;
            new Thread(() -> {
                String nodeDir = getApplicationContext().getFilesDir().getAbsolutePath() + "/tizentube";
                startNodeWithArguments(new String[]{"node", nodeDir});
            }).start();
        } else {
            TextView text = (TextView)findViewById(R.id.textView);
            text.setText("Already running.");
        }
    }

    public void launchApp(View v) {
        URI uri = null;
        try {
            uri = new URI("ws://127.0.0.1:3000/");
        } catch (URISyntaxException e) {
            e.printStackTrace();
        }
        wsClient = new WebSocketClient(uri) {

            @Override
            public void onOpen(ServerHandshake handshakedata) {
                wsClient.send("{\"e\": \"launch\"}");
            }

            @Override
            public void onMessage(String message) {
                TextView text = (TextView)findViewById(R.id.textView);
                text.setText("Started the app.");
            }

            @Override
            public void onClose(int code, String reason, boolean remote) {

            }

            @Override
            public void onError(Exception ex) {
                ex.printStackTrace();
            }
        };

        wsClient.connect();
    }
}