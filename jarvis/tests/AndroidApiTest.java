package im.nexar.jarvis;

// Host-side API tests: Android storage is replaced with in-memory stubs.
// This checks request/state logic, not Android Keystore or real phone audio.
import android.content.*;
import java.io.*;
import java.net.*;
import java.util.*;
import javax.net.ssl.*;
import org.json.*;

public class AndroidApiTest {
  static final String UID="123e4567-e89b-12d3-a456-426614174000";
  static JSONObject remote=new JSONObject();
  static JSONObject lastPatch;
  static boolean rpcFail,weatherFail,refreshInvalid,refreshOffline;
  static int refreshes;
  static String lastAuthorization;
  static Runnable duringRpc;
  static void check(boolean b,String message){if(!b)throw new AssertionError(message);}
  static String response(String path,Map<String,String> headers,String body)throws Exception{
    if(path.contains("grant_type=password"))return new JSONObject().put("access_token","access-test").put("refresh_token","refresh-test").put("expires_in",3600).put("user",new JSONObject().put("id",UID).put("email","test@example.invalid")).toString();
    if(path.contains("grant_type=refresh_token")){refreshes++;return refreshInvalid?"{\"error\":\"invalid_grant\"}":"{\"message\":\"offline\"}";}
    if(path.contains("/auth/v1/logout"))return "{}";
    if(path.contains("/auth/v1/signup"))return "{\"user\":{\"id\":\"confirmation-required\"}}";
    if(path.contains("geocoding"))return "{\"results\":[{\"name\":\"Wien\",\"latitude\":48.2,\"longitude\":16.3}]}";
    if(path.contains("open-meteo"))return weatherFail?"{\"message\":\"upstream offline\"}":"{\"current\":{\"temperature_2m\":14.4,\"weather_code\":3,\"wind_speed_10m\":7}}";
    lastAuthorization=headers.get("Authorization");
    if(path.contains("/rpc/jarvis_merge_settings")){
      if(rpcFail)return "{\"message\":\"offline\"}";
      lastPatch=new JSONObject(body).getJSONObject("p_patch");
      for(String key:lastPatch.keySet())remote.put(key,lastPatch.get(key));
      if(duringRpc!=null){Runnable r=duringRpc;duringRpc=null;r.run();}
      return remote.toString();
    }
    if(path.contains("/jarvis_profiles?")){check(path.contains("limit=1"),"bounded profile read");return new JSONArray().put(new JSONObject().put("id",UID).put("settings",remote)).toString();}
    throw new AssertionError("Unexpected request: "+path);
  }
  static class Fake extends HttpsURLConnection {
    Map<String,String> h=new HashMap<>();ByteArrayOutputStream out=new ByteArrayOutputStream();String result;int status;
    Fake(URL u){super(u);}
    public void setRequestProperty(String k,String v){h.put(k,v);}
    public OutputStream getOutputStream(){return out;}
    public int getResponseCode()throws IOException{if(result==null)try{String u=url.toString();result=response(u,h,out.toString("UTF-8"));status=(u.contains("grant_type=refresh_token")?(refreshInvalid?400:503):(u.contains("/rpc/")&&rpcFail)||(u.contains("/forecast?")&&weatherFail)?503:200);}catch(Exception e){throw new IOException(e);}return status;}
    public InputStream getInputStream()throws IOException{getResponseCode();return new ByteArrayInputStream(result.getBytes("UTF-8"));}
    public InputStream getErrorStream(){try{return getInputStream();}catch(Exception e){return null;}}
    public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
    public String getCipherSuite(){return "test";}public java.security.cert.Certificate[] getLocalCertificates(){return null;}public java.security.cert.Certificate[] getServerCertificates(){return null;}
  }
  static class Prefs implements SharedPreferences {
    final Map<String,Object> m=new java.util.concurrent.ConcurrentHashMap<>();
    public Map<String,?>getAll(){return new HashMap<>(m);}public String getString(String k,String d){Object o=m.get(k);return o instanceof String?(String)o:d;}
    @SuppressWarnings("unchecked") public Set<String>getStringSet(String k,Set<String>d){return m.containsKey(k)?(Set<String>)m.get(k):d;}
    public int getInt(String k,int d){return m.containsKey(k)?(Integer)m.get(k):d;}public long getLong(String k,long d){return m.containsKey(k)?(Long)m.get(k):d;}public float getFloat(String k,float d){return m.containsKey(k)?(Float)m.get(k):d;}public boolean getBoolean(String k,boolean d){return m.containsKey(k)?(Boolean)m.get(k):d;}public boolean contains(String k){return m.containsKey(k);}
    public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l){}public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l){}
    public Editor edit(){return new Editor(){Map<String,Object> changes=new HashMap<>();boolean clear;public Editor putString(String k,String v){changes.put(k,v);return this;}public Editor putStringSet(String k,Set<String>v){changes.put(k,v);return this;}public Editor putInt(String k,int v){changes.put(k,v);return this;}public Editor putLong(String k,long v){changes.put(k,v);return this;}public Editor putFloat(String k,float v){changes.put(k,v);return this;}public Editor putBoolean(String k,boolean v){changes.put(k,v);return this;}public Editor remove(String k){changes.put(k,null);return this;}public Editor clear(){clear=true;return this;}public boolean commit(){apply();return true;}public void apply(){if(clear)m.clear();for(Map.Entry<String,Object>e:changes.entrySet())if(e.getValue()==null)m.remove(e.getKey());else m.put(e.getKey(),e.getValue());}};}
  }
  static void sync(DesktopApi api)throws Exception{api.syncSettings();java.lang.reflect.Field f=DesktopApi.class.getDeclaredField("syncInFlight");f.setAccessible(true);long end=System.currentTimeMillis()+3000;while((Boolean)f.get(api)&&System.currentTimeMillis()<end)Thread.sleep(10);check(!(Boolean)f.get(api),"sync must complete");}
  public static void main(String[] args)throws Exception{
    URL.setURLStreamHandlerFactory(p->"https".equals(p)?new URLStreamHandler(){protected URLConnection openConnection(URL u){return new Fake(u);}}:null);
    Prefs p=new Prefs();DesktopApi api=new DesktopApi(null,p);api.cloudUrl="https://cloud.test";api.anonKey="public-test";
    p.edit().putString("voice",DesktopApi.DEFAULT_VOICE).putString("city","Wien").apply();
    check(api.cloudSignup("test@example.invalid","not-real").contains("bestätigen"),"signup must not claim a session");check(api.secure.get("accessToken").isEmpty(),"confirmation is not login");
    check(api.cloudLogin("test@example.invalid","not-real").equals("Angemeldet"),"login");check(!p.getAll().containsKey("accessToken"),"tokens must not enter ordinary preferences");
    remote.put("voice",DesktopApi.DEFAULT_VOICE).put("weatherCity","Graz");sync(api);check("Bearer access-test".equals(lastAuthorization),"access token, never refresh token, is the bearer");check("Graz".equals(p.getString("city","")),"clean pull");
    api.saveLocalSettings("de-AT-JonasNeural","Graz");sync(api);check(lastPatch.length()==1&&lastPatch.has("voice"),"only dirty field sent");check(!p.getBoolean("settingsDirty",true),"successful RPC clears pending");
    remote.put("weatherCity","Linz");sync(api);check("Linz".equals(p.getString("city","")),"subsequent remote changes are not frozen out");
    api.saveLocalSettings("de-DE-KatjaNeural","Linz");rpcFail=true;sync(api);check(p.getBoolean("settingsDirty",false),"offline dirty remains");rpcFail=false;sync(api);check(!p.getBoolean("settingsDirty",true),"retry succeeds");
    api.saveLocalSettings("de-DE-ConradNeural","Linz");duringRpc=()->api.saveLocalSettings("de-DE-ConradNeural","Salzburg");sync(api);check("Salzburg".equals(p.getString("city",""))&&p.getBoolean("settingsDirty",false),"new local edit survives an in-flight RPC");sync(api);check("Salzburg".equals(remote.getString("weatherCity"))&&!p.getBoolean("settingsDirty",true),"new edit retried");
    check(api.weather("Wien").contains("14,4"),"real parsed weather response");weatherFail=true;check(api.weather("Wien").contains("nicht verfügbar"),"no invented weather on error");weatherFail=false;
    api.secure.put("token","desktop-test");api.secure.put("expiresAt","0");int before=refreshes;api.cloudLogout();check(refreshes==before,"logout must not refresh or recurse");check("desktop-test".equals(api.secure.get("token")),"cloud logout preserves desktop pairing");
    api.cloudLogin("test@example.invalid","not-real");api.secure.put("expiresAt","0");refreshInvalid=true;sync(api);check(api.secure.get("refreshToken").isEmpty(),"definitively invalid refresh signs out safely");refreshInvalid=false;
    api.cloudLogin("test@example.invalid","not-real");api.secure.put("expiresAt","0");api.saveLocalSettings(DesktopApi.DEFAULT_VOICE,"Wien");sync(api);check(!api.secure.get("refreshToken").isEmpty()&&p.getBoolean("settingsDirty",false),"offline refresh preserves credentials and pending edits");
    System.out.println("ANDROID_API_HOST_TEST_PASS: access bearer, signup confirmation, atomic patches, offline retry, concurrent local edit, weather, safe logout/refresh");
  }
}

// Deliberate test substitute. Production uses Android Keystore AES/GCM instead.
final class SecureStore {
  final Map<String,String> data=new java.util.concurrent.ConcurrentHashMap<>();
  SecureStore(Context c,SharedPreferences p){}
  String get(String k){return data.getOrDefault(k,"");}void put(String k,String v){data.put(k,v);}void remove(String k){data.remove(k);}
}
