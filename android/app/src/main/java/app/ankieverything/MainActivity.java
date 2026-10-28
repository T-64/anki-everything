package app.ankieverything;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AnkiBridgePlugin.class);
        registerPlugin(ShareInboxPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
