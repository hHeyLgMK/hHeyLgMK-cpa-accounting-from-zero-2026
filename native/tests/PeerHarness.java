package cn.cpa26.workbook;
import java.io.*;
import java.security.*;
import javax.net.ssl.*;
import org.json.*;
public class PeerHarness {
 public static void main(String[] args)throws Exception {
  KeyStore ks=KeyStore.getInstance("PKCS12");ks.load(new FileInputStream(args[0]),new char[0]);
  KeyManagerFactory km=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());km.init(ks,new char[0]);
  SSLContext ctx=SSLContext.getInstance("TLS");ctx.init(km.getKeyManagers(),null,new SecureRandom());
  String alias=ks.aliases().nextElement(),id=PeerNode.hex(MessageDigest.getInstance("SHA-256").digest(ks.getCertificate(alias).getEncoded()));
  PeerNode node=new PeerNode(ctx,id,new File(args[1]),"Android-test",args[2],Integer.parseInt(args[3]));
  System.out.println(node.localInfo());System.out.flush();
  BufferedReader input=new BufferedReader(new InputStreamReader(System.in,"UTF-8"));String line;
  while((line=input.readLine())!=null)try{System.out.println(new JSONObject().put("ok",true).put("result",node.local(new JSONObject(line))));System.out.flush();}
  catch(Exception e){System.out.println(new JSONObject().put("ok",false).put("error",e.toString()));System.out.flush();}
  node.close();
 }
}
