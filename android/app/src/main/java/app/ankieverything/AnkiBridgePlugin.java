package app.ankieverything;

import android.content.ContentProviderClient;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;

/**
 * AnkiDroid 桥接。直接调用 AnkiDroid 的 ContentProvider（FlashCardsContract），
 * 列名和用法照 ankidroid/Anki-Android 的 api 模块（AddContentApi.kt）。这里只做转发，流程在 src/client/anki.ts。
 */
@CapacitorPlugin(
    name = "AnkiBridge",
    permissions = { @Permission(alias = "anki", strings = { AnkiBridgePlugin.PERMISSION }) }
)
public class AnkiBridgePlugin extends Plugin {

    static final String PACKAGE = "com.ichi2.anki";
    static final String PERMISSION = "com.ichi2.anki.permission.READ_WRITE_DATABASE";
    private static final Uri AUTHORITY = Uri.parse("content://com.ichi2.anki.flashcards");
    private static final Uri NOTES = Uri.withAppendedPath(AUTHORITY, "notes");
    private static final Uri MODELS = Uri.withAppendedPath(AUTHORITY, "models");
    private static final Uri DECKS = Uri.withAppendedPath(AUTHORITY, "decks");
    private static final Uri MEDIA = Uri.withAppendedPath(AUTHORITY, "media");
    private static final String FIELD_SEPARATOR = "\u001f";

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    private boolean installed() {
        try {
            getContext().getPackageManager().getPackageInfo(PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    /**
     * AnkiDroid 的数据接口现在能不能连上。有的系统（如 vivo）不允许在后台唤醒别的 App：
     * AnkiDroid 被冻结或回收后，接口直接找不到（"Unknown URL"），要先把 AnkiDroid 打开一次。
     */
    private boolean reachable() {
        ContentProviderClient client = resolver().acquireUnstableContentProviderClient(AUTHORITY.getAuthority());
        if (client == null) return false;
        client.close();
        return true;
    }

    private JSObject statusObject() {
        boolean installed = installed();
        boolean permission = ContextCompat.checkSelfPermission(getContext(), PERMISSION) == PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("installed", installed);
        result.put("permission", permission);
        result.put("reachable", installed && permission && reachable());
        return result;
    }

    /** 把 AnkiDroid 打开到前台（它被系统冻结时，只有这样才能让接口重新可用） */
    @PluginMethod
    public void openAnkiDroid(PluginCall call) {
        Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(PACKAGE);
        if (intent == null) {
            call.reject("没有找到 AnkiDroid");
            return;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (!installed() || getPermissionState("anki") == PermissionState.GRANTED) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAlias("anki", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(statusObject());
    }

    /** 没有就创建笔记类型和牌组；CSS 不一样（笔记类型版本变了）就更新 CSS 和模板。字段不改（接口也不支持） */
    @PluginMethod
    public void ensureNoteType(PluginCall call) {
        try {
            String name = call.getString("name");
            String css = call.getString("css");
            String cardName = call.getString("cardName");
            String front = call.getString("front");
            String back = call.getString("back");
            List<String> fields = call.getArray("fields").toList();
            long modelId = -1;
            String currentCss = null;
            try (Cursor cursor = resolver().query(MODELS, null, null, null, null)) {
                while (cursor != null && cursor.moveToNext()) {
                    if (name.equals(cursor.getString(cursor.getColumnIndexOrThrow("name")))) {
                        modelId = cursor.getLong(cursor.getColumnIndexOrThrow("_id"));
                        currentCss = cursor.getString(cursor.getColumnIndexOrThrow("css"));
                        break;
                    }
                }
            }
            if (modelId < 0) {
                ContentValues values = new ContentValues();
                values.put("name", name);
                values.put("field_names", String.join(FIELD_SEPARATOR, fields));
                values.put("num_cards", 1);
                values.put("css", css);
                values.put("sort_field_index", 0);
                Uri modelUri = resolver().insert(MODELS, values);
                if (modelUri == null) throw new IllegalStateException("AnkiDroid 拒绝创建笔记类型");
                modelId = Long.parseLong(modelUri.getLastPathSegment());
                updateTemplate(modelUri, cardName, front, back);
            } else if (!css.equals(currentCss)) {
                Uri modelUri = Uri.withAppendedPath(MODELS, Long.toString(modelId));
                ContentValues values = new ContentValues();
                values.put("css", css);
                resolver().update(modelUri, values, null, null);
                updateTemplate(modelUri, cardName, front, back);
            }
            JSObject result = new JSObject();
            result.put("modelId", modelId);
            result.put("deckId", ensureDeck(call.getString("deck")));
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    private void updateTemplate(Uri modelUri, String cardName, String front, String back) {
        ContentValues values = new ContentValues();
        values.put("card_template_name", cardName);
        values.put("question_format", front);
        values.put("answer_format", back);
        resolver().update(Uri.withAppendedPath(Uri.withAppendedPath(modelUri, "templates"), "0"), values, null, null);
    }

    private long ensureDeck(String deckName) {
        try (Cursor cursor = resolver().query(DECKS, null, null, null, null)) {
            while (cursor != null && cursor.moveToNext()) {
                if (deckName.equals(cursor.getString(cursor.getColumnIndexOrThrow("deck_name")))) {
                    return cursor.getLong(cursor.getColumnIndexOrThrow("deck_id"));
                }
            }
        }
        ContentValues values = new ContentValues();
        values.put("deck_name", deckName);
        Uri deckUri = resolver().insert(DECKS, values);
        if (deckUri == null) throw new IllegalStateException("AnkiDroid 拒绝创建牌组");
        return Long.parseLong(deckUri.getLastPathSegment());
    }

    /** 按 AEID 字段搜索（Anki 搜索语法） */
    @PluginMethod
    public void findByAeid(PluginCall call) {
        String aeid = call.getString("aeid", "");
        if (!aeid.matches("[0-9a-fA-F-]+")) {
            call.reject("aeid 格式不对");
            return;
        }
        try (Cursor cursor = resolver().query(NOTES, new String[] { "_id" }, "AEID:" + aeid, null, null)) {
            JSObject result = new JSObject();
            if (cursor != null && cursor.moveToFirst()) result.put("noteId", cursor.getLong(0));
            else result.put("noteId", JSObject.NULL);
            call.resolve(result);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    /** 图片写进临时文件，授权给 AnkiDroid 读，再放进它的媒体库；返回媒体库里的文件名 */
    @PluginMethod
    public void addImage(PluginCall call) {
        try {
            String dataUrl = call.getString("dataUrl");
            String name = call.getString("name");
            byte[] bytes = Base64.decode(dataUrl.substring(dataUrl.indexOf(',') + 1), Base64.DEFAULT);
            File directory = new File(getContext().getCacheDir(), "anki-media");
            directory.mkdirs();
            File file = new File(directory, name + ".jpg");
            try (FileOutputStream output = new FileOutputStream(file)) {
                output.write(bytes);
            }
            Uri fileUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            getContext().grantUriPermission(PACKAGE, fileUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ContentValues values = new ContentValues();
            values.put("file_uri", fileUri.toString());
            values.put("preferred_name", name);
            Uri result = resolver().insert(MEDIA, values);
            file.delete();
            if (result == null || result.getPath() == null) throw new IllegalStateException("AnkiDroid 拒绝保存图片");
            JSObject response = new JSObject();
            response.put("file", new File(result.getPath()).getName());
            call.resolve(response);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    /** 加笔记，再把生成的卡片移到指定牌组 */
    @PluginMethod
    public void addNote(PluginCall call) {
        try {
            long modelId = call.getLong("modelId");
            long deckId = call.getLong("deckId");
            List<String> fields = call.getArray("fields").toList();
            List<String> tags = call.getArray("tags", new JSArray()).toList();
            ContentValues values = new ContentValues();
            values.put("mid", modelId);
            values.put("flds", String.join(FIELD_SEPARATOR, fields));
            values.put("tags", String.join(" ", tags));
            Uri noteUri = resolver().insert(NOTES, values);
            if (noteUri == null) throw new IllegalStateException("AnkiDroid 拒绝添加笔记");
            Uri cardsUri = Uri.withAppendedPath(noteUri, "cards");
            List<String> ords = new ArrayList<>();
            try (Cursor cursor = resolver().query(cardsUri, null, null, null, null)) {
                while (cursor != null && cursor.moveToNext()) ords.add(cursor.getString(cursor.getColumnIndexOrThrow("ord")));
            }
            for (String ord : ords) {
                ContentValues card = new ContentValues();
                card.put("deck_id", deckId);
                resolver().update(Uri.withAppendedPath(cardsUri, ord), card, null, null);
            }
            JSObject result = new JSObject();
            result.put("noteId", Long.parseLong(noteUri.getLastPathSegment()));
            call.resolve(result);
        } catch (JSONException e) {
            call.reject("参数不对: " + e.getMessage(), e);
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }
}
