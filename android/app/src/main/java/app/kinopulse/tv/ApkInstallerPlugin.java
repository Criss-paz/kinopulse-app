package app.kinopulse.tv;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** Downloads the new APK inside the app and opens Android's install screen, so TVs never need a browser/downloader. */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", canRequestInstalls());
        call.resolve(ret);
    }

    /** Opens the "install unknown apps" setting for KinoPulse (needed once per device on Android 8+). */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                getContext().startActivity(i);
            } catch (Exception e) {
                // Some TV launchers lack this screen; the install prompt itself will ask instead.
            }
        }
        call.resolve();
    }

    /**
     * Hosts allowed to serve an update. The interface is loaded from the live site, so any
     * script running there can call this plugin: without this list, a compromised or injected
     * page could make every installed app download and install an APK of someone else's
     * choosing. "latest/download" redirects to githubusercontent, so that host is allowed too.
     * Only HTTPS, and every redirect hop is checked again.
     */
    private static final String[] ALLOWED_HOSTS = {
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    };

    private static boolean isAllowed(String url) {
        try {
            URL u = new URL(url);
            if (!"https".equalsIgnoreCase(u.getProtocol())) return false;
            String host = u.getHost().toLowerCase();
            for (String allowed : ALLOWED_HOSTS) {
                if (host.equals(allowed)) return true;
            }
        } catch (Exception e) {
            // Falls through to false: an unparseable URL is not allowed.
        }
        return false;
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            call.reject("url is required");
            return;
        }
        if (!isAllowed(url)) {
            call.reject("Update URL not allowed: " + url);
            return;
        }
        new Thread(() -> {
            try {
                File apk = new File(getContext().getCacheDir(), "kinopulse-update.apk");
                download(url, apk);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("Update failed: " + e.getMessage(), e);
            }
        }).start();
    }

    private boolean canRequestInstalls() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void download(String src, File dest) throws Exception {
        // GitHub's "latest/download" link redirects across hosts, which HttpURLConnection won't follow on its own.
        for (int hops = 0; hops < 5; hops++) {
            HttpURLConnection conn = (HttpURLConnection) new URL(src).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String next = conn.getHeaderField("Location");
                conn.disconnect();
                // Un redirect es otra URL distinta a la que ya se valido: se comprueba igual,
                // si no basta con una redireccion a un host cualquiera para saltarse la lista.
                if (next == null) throw new Exception("Redirect without Location");
                if (next.startsWith("/")) next = new URL(new URL(src), next).toString();
                if (!isAllowed(next)) throw new Exception("Redirect to a host that is not allowed");
                src = next;
                continue;
            }
            if (code != 200) throw new Exception("HTTP " + code);
            long total = conn.getContentLengthLong();
            try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(dest)) {
                byte[] buf = new byte[64 * 1024];
                long done = 0;
                int lastPct = -1;
                int n;
                while ((n = in.read(buf)) != -1) {
                    out.write(buf, 0, n);
                    done += n;
                    int pct = total > 0 ? (int) (done * 100 / total) : -1;
                    if (pct != lastPct) {
                        lastPct = pct;
                        JSObject p = new JSObject();
                        p.put("percent", pct);
                        notifyListeners("progress", p);
                    }
                }
            } finally {
                conn.disconnect();
            }
            return;
        }
        throw new Exception("Too many redirects");
    }
}
