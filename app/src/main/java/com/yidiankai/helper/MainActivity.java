package com.yidiankai.helper;

import android.annotation.SuppressLint;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "YidiankaiHelper";
    private static final String BASE_URL = "https://www.yidiankai.net/";

    private WebView webView;
    private ProgressBar progressBar;
    private String userscript;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webview);
        progressBar = findViewById(R.id.progress_bar);

        // Load userscript from assets
        loadUserscript();

        // Configure WebView
        configureWebView();

        // Load the website
        webView.loadUrl(BASE_URL);
    }

    private void loadUserscript() {
        try {
            InputStream is = getAssets().open("userscript.js");
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(is, StandardCharsets.UTF_8)
            );
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append("\n");
            }
            reader.close();
            userscript = sb.toString();
            Log.d(TAG, "Userscript loaded, length: " + userscript.length());
        } catch (Exception e) {
            Log.e(TAG, "Failed to load userscript", e);
            Toast.makeText(this, "脚本加载失败: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();

        // Enable JavaScript
        settings.setJavaScriptEnabled(true);

        // Enable DOM storage (needed for the site to work)
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // Cache mode
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Make the site work properly in WebView
        settings.setUserAgentString(
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        );
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);

        // Allow mixed content (http in https pages)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        }

        // Accept all cookies
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        // WebViewClient: handle page loading and inject JS
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Keep all navigation within the WebView
                String url = request.getUrl().toString();
                if (url.contains("yidiankai.net")) {
                    return false; // Load in WebView
                }
                // Open external links in browser (or block them)
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // Inject the userscript on every page load
                injectUserscript();
            }
        });

        // WebChromeClient: handle progress and JS dialogs
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    progressBar.setVisibility(View.VISIBLE);
                    progressBar.setProgress(newProgress);
                } else {
                    progressBar.setVisibility(View.GONE);
                }
            }
        });
    }

    private void injectUserscript() {
        if (userscript == null || userscript.isEmpty()) {
            Log.w(TAG, "Userscript is empty, cannot inject");
            return;
        }

        // Wrap in IIFE and execute
        String js = "javascript:(function(){" + userscript + "})();";
        webView.evaluateJavascript(js, value -> {
            Log.d(TAG, "Userscript injected, result: " + (value != null ? value.substring(0, Math.min(100, value.length())) : "null"));
        });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Handle back button: go back in WebView history
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) {
            webView.onPause();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
