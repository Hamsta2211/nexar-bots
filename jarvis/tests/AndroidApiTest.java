package im.nexar.jarvis;

// Host-side API tests: Android storage is replaced with in-memory stubs.
// This checks request/state logic, not Android Keystore or real phone audio.
import android.content.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.CountDownLatch;
import javax.net.ssl.*;
import org.json.*;

public class AndroidApiTest {
  static final String UID="123e4567-e89b-12d3-a456-426614174000";
  static JSONObject remote=new JSONObject();
  static JSONObject lastPatch;
  static boolean rpcFail,weatherFail,refreshInvalid,refreshOffline;
  static boolean desktopFail;
  static int refreshes;
  static String lastAuthorization;
  static String lastDesktopMethod,lastDesktopPath,lastDesktopBody;
  static int lastDesktopReadTimeout,lastDesktopConnectTimeout;
  static boolean lastDesktopRedirects;
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
    if(path.startsWith("https://desktop.test")){
      lastDesktopPath=path.substring("https://desktop.test".length());
      if(desktopFail)return "{\"message\":\"PC offline\"}";
      if(lastDesktopPath.equals("/brain"))return new JSONObject().put("provider","local").put("localUrl","http://127.0.0.1:11434").put("localModel","llama3").put("groqModel","llama-3.1-70b").put("hasGroqKey",true).put("keyStorage","secure").put("busy",false).toString();
      if(lastDesktopPath.startsWith("/brain/models?provider="))return new JSONArray().put(new JSONObject().put("id","llama3").put("name","Llama 3")).put(new JSONObject().put("id","mistral")).toString();
      if(lastDesktopPath.equals("/brain/ask"))return new JSONObject().put("text","Grüße, 世界").put("provider","local").put("model","llama3").toString();
      if(lastDesktopPath.equals("/brain")||lastDesktopPath.equals("/brain/cancel")||lastDesktopPath.equals("/brain/reset"))return "{}";
      throw new AssertionError("Unexpected desktop request: "+lastDesktopPath);
    }
    throw new AssertionError("Unexpected request: "+path);
  }
  static class Fake extends HttpsURLConnection {
    Map<String,String> h=new HashMap<>();ByteArrayOutputStream out=new ByteArrayOutputStream();String result;int status;int readTimeout,connectTimeout;boolean redirects;
    Fake(URL u){super(u);}
    public void setRequestProperty(String k,String v){h.put(k,v);}
    public void setRequestMethod(String m)throws ProtocolException{super.setRequestMethod(m);}
    public void setReadTimeout(int n){readTimeout=n;if(url.toString().startsWith("https://desktop.test"))lastDesktopReadTimeout=n;}
    public void setConnectTimeout(int n){connectTimeout=n;if(url.toString().startsWith("https://desktop.test"))lastDesktopConnectTimeout=n;}
    public void setInstanceFollowRedirects(boolean b){redirects=b;if(url.toString().startsWith("https://desktop.test"))lastDesktopRedirects=b;}
    public OutputStream getOutputStream(){return out;}
    public int getResponseCode()throws IOException{if(result==null)try{String u=url.toString();lastDesktopMethod=getRequestMethod();lastDesktopBody=out.toString("UTF-8");if(u.startsWith("https://desktop.test"))lastAuthorization=h.get("Authorization");result=response(u,h,lastDesktopBody);status=(u.startsWith("https://desktop.test")&&desktopFail)?503:(u.contains("grant_type=refresh_token")?(refreshInvalid?400:503):(u.contains("/rpc/")&&rpcFail)||(u.contains("/forecast?")&&weatherFail)?503:200);}catch(Exception e){throw new IOException(e);}return status;}
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
    // Desktop brain API: the fake deliberately ignores certificate pinning, but checks HTTPS routing/auth/JSON.
    p.edit().putString("baseUrl","https://desktop.test").putString("fingerprint",String.join("",Collections.nCopies(64,"a"))).apply();api.secure.put("token","desktop-test");
    CountDownLatch latch=new CountDownLatch(1);final DesktopApi.BrainState[] state={null};final String[] err={null};api.brainState((s,e)->{state[0]=s;err[0]=e;latch.countDown();});check(latch.await(3,java.util.concurrent.TimeUnit.SECONDS),"brain state callback timeout");check(err[0]==null&&"local".equals(state[0].provider)&&"http://127.0.0.1:11434".equals(state[0].localUrl),"brain state parse");check("GET".equals(lastDesktopMethod)&&"/brain".equals(lastDesktopPath)&&"Bearer desktop-test".equals(lastAuthorization),"brain route and bearer");check(lastDesktopReadTimeout==9000&&!lastDesktopRedirects,"normal desktop timeout and redirects disabled");
    final CountDownLatch modelsLatch=new CountDownLatch(1);final List<DesktopApi.BrainModel>[] models=new List[]{null};err[0]=null;api.brainModels("local",(m,e)->{models[0]=m;err[0]=e;modelsLatch.countDown();});check(modelsLatch.await(3,java.util.concurrent.TimeUnit.SECONDS),"brain models callback timeout");check(err[0]==null&&models[0].size()==2&&"llama3".equals(models[0].get(0).id),"model list array");check("GET".equals(lastDesktopMethod)&&"/brain/models?provider=local".equals(lastDesktopPath),"model route");
    final CountDownLatch saveLatch=new CountDownLatch(1);err[0]=null;api.saveBrain("groq","llama3","mixtral",e->{err[0]=e;saveLatch.countDown();});check(saveLatch.await(3,java.util.concurrent.TimeUnit.SECONDS),"save callback timeout");JSONObject save=new JSONObject(lastDesktopBody);check(err[0]==null&&"groq".equals(save.getString("provider"))&&"llama3".equals(save.getString("localModel"))&&"mixtral".equals(save.getString("groqModel"))&&!save.has("apiKey")&&!save.has("localUrl"),"save config body");check("PUT".equals(lastDesktopMethod)&&"/brain".equals(lastDesktopPath),"save route");
    final CountDownLatch askLatch=new CountDownLatch(1);final String[] answer={null},answerProvider={null},answerModel={null};err[0]=null;api.askBrain("ÄÖÜ 世界?",(t,pr,m,e)->{answer[0]=t;answerProvider[0]=pr;answerModel[0]=m;err[0]=e;askLatch.countDown();});check(askLatch.await(3,java.util.concurrent.TimeUnit.SECONDS),"ask callback timeout");check(err[0]==null&&"Grüße, 世界".equals(answer[0])&&"local".equals(answerProvider[0])&&"llama3".equals(answerModel[0]),"unicode ask response");check(lastDesktopReadTimeout==70000&&"POST".equals(lastDesktopMethod)&&"/brain/ask".equals(lastDesktopPath),"ask timeout and route");
    for(String op:new String[]{"cancel","reset"}){final CountDownLatch opLatch=new CountDownLatch(1);err[0]=null;if(op.equals("cancel"))api.cancelBrain(e->{err[0]=e;opLatch.countDown();});else api.resetBrain(e->{err[0]=e;opLatch.countDown();});check(opLatch.await(3,java.util.concurrent.TimeUnit.SECONDS),op+" callback timeout");check(err[0]==null&&("/brain/"+op).equals(lastDesktopPath)&&"POST".equals(lastDesktopMethod),op+" route");}
    desktopFail=true;final CountDownLatch errorLatch=new CountDownLatch(1);err[0]=null;api.brainState((s,e)->{err[0]=e;errorLatch.countDown();});check(errorLatch.await(3,java.util.concurrent.TimeUnit.SECONDS)&&err[0]!=null&&err[0].contains("PC offline"),"desktop HTTP error");desktopFail=false;
    p.edit().remove("baseUrl").remove("fingerprint").apply();final CountDownLatch unpairedLatch=new CountDownLatch(1);err[0]=null;api.askBrain("offline",(t,pr,m,e)->{err[0]=e;unpairedLatch.countDown();});check(unpairedLatch.await(3,java.util.concurrent.TimeUnit.SECONDS)&&err[0]!=null&&err[0].contains("bitte zuerst einen PC koppeln"),"clear PC pairing friendly message");
    System.out.println("ANDROID_API_HOST_TEST_PASS: access bearer, signup confirmation, atomic patches, offline retry, concurrent local edit, weather, safe logout/refresh, desktop brain state/models/save/ask/cancel/reset");
  }
}

// Deliberate test substitute. Production uses Android Keystore AES/GCM instead.
final class SecureStore {
  final Map<String,String> data=new java.util.concurrent.ConcurrentHashMap<>();
  SecureStore(Context c,SharedPreferences p){}
  String get(String k){return data.getOrDefault(k,"");}void put(String k,String v){data.put(k,v);}void remove(String k){data.remove(k);}
}
