package im.nexar.jarvis;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Small, dependency-free AES/GCM store for credentials. Non-secret UI settings remain normal prefs. */
final class SecureStore {
  private static final String KS="AndroidKeyStore", ALIAS="jarvis.credentials.v1";
  private final SharedPreferences p;
  SecureStore(Context c, SharedPreferences p){this.p=p; migrate(c);}
  private SecretKey key() throws Exception {
    KeyStore ks=KeyStore.getInstance(KS); ks.load(null);
    if(!ks.containsAlias(ALIAS)){KeyGenerator g=KeyGenerator.getInstance("AES",KS);g.init(256);g.generateKey();}
    return ((KeyStore.SecretKeyEntry)ks.getEntry(ALIAS,null)).getSecretKey();
  }
  String get(String name){try{String v=p.getString("secure_"+name,null);if(v==null)return "";byte[] all=Base64.decode(v,Base64.NO_WRAP);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,all,0,12));return new String(c.doFinal(all,12,all.length-12),StandardCharsets.UTF_8);}catch(Exception e){return "";}}
  void put(String name,String value){try{Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());byte[] iv=c.getIV(), data=c.doFinal(value.getBytes(StandardCharsets.UTF_8));byte[] all=new byte[iv.length+data.length];System.arraycopy(iv,0,all,0,iv.length);System.arraycopy(data,0,all,iv.length,data.length);p.edit().putString("secure_"+name,Base64.encodeToString(all,Base64.NO_WRAP)).remove(name).apply();}catch(Exception ignored){}}
  void remove(String name){p.edit().remove("secure_"+name).remove(name).apply();}
  private void migrate(Context c){for(String n:new String[]{"token","refreshToken","password"}){if(p.contains(n)&&!p.contains("secure_"+n)){String v=p.getString(n,"");if(!v.isEmpty())put(n,v);else p.edit().remove(n).apply();}}}
}
