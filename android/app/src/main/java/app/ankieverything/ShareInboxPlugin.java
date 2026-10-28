package app.ankieverything;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * 系统分享菜单收到的图片。界面启动时和收到新分享时调用 take() 取走，压缩交给界面做。
 */
@CapacitorPlugin(name = "ShareInbox")
public class ShareInboxPlugin extends Plugin {

    private Uri pending;

    @Override
    public void load() {
        accept(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (accept(intent)) notifyListeners("shared", new JSObject());
    }

    private boolean accept(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        String type = intent.getType();
        if (type == null || !type.startsWith("image/")) return false;
        Uri uri = Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
            : intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) return false;
        pending = uri;
        // 同一个分享只处理一次：之后 App 从后台回来不会再弹
        intent.setAction(Intent.ACTION_MAIN);
        return true;
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject result = new JSObject();
        Uri uri = pending;
        pending = null;
        if (uri == null) {
            result.put("dataUrl", JSObject.NULL);
            call.resolve(result);
            return;
        }
        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            String mime = getContext().getContentResolver().getType(uri);
            result.put("dataUrl", "data:" + (mime != null ? mime : "image/jpeg") + ";base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }
}
