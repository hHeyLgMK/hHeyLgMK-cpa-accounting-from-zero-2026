using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.Security;
using System.Reflection;
using System.Runtime.Serialization;
using System.Collections.Generic;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading.Tasks;

public static class WindowsCertificateTest {
 static X509Certificate2 Load(Assembly app,string directory) {
  var type=app.GetType("PeerApp",true);
  var instance=FormatterServices.GetUninitializedObject(type);
  type.GetField("directory",BindingFlags.Instance|BindingFlags.NonPublic).SetValue(instance,directory);
  try{return (X509Certificate2)type.GetMethod("LoadCertificate",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(instance,null);}
  catch(TargetInvocationException error){throw new Exception("Certificate creation failed",error.InnerException);}
 }
 static string Fingerprint(X509Certificate2 cert){using(var hash=SHA256.Create())return BitConverter.ToString(hash.ComputeHash(cert.RawData));}
 static void Require(bool condition,string message){if(!condition)throw new Exception(message);}
 static void CheckTLS(X509Certificate2 cert) {
  var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();
  try {
   int port=((IPEndPoint)listener.LocalEndpoint).Port;
   var server=Task.Run(()=>{
    using(var tcp=listener.AcceptTcpClient())using(var stream=new SslStream(tcp.GetStream(),false)){
     tcp.ReceiveTimeout=8000;tcp.SendTimeout=8000;
     stream.AuthenticateAsServer(cert,false,SslProtocols.Tls12,false);
     Require(stream.ReadByte()==42,"TLS request mismatch");stream.WriteByte(43);stream.Flush();
    }
   });
   using(var tcp=new TcpClient()){
    tcp.Connect(IPAddress.Loopback,port);tcp.ReceiveTimeout=8000;tcp.SendTimeout=8000;
    using(var stream=new SslStream(tcp.GetStream(),false,(sender,peer,chain,errors)=>{
     using(var remote=new X509Certificate2(peer))return Fingerprint(remote)==Fingerprint(cert);
    })){
     stream.AuthenticateAsClient("CPA LAN",null,SslProtocols.Tls12,false);
     stream.WriteByte(42);stream.Flush();Require(stream.ReadByte()==43,"TLS response mismatch");
    }
   }
   Require(server.Wait(10000),"TLS server timeout");
  }finally{listener.Stop();}
 }
 static void CheckStartup(Assembly app,string directory,string expectedIdentity) {
  var type=app.GetType("PeerApp",true);
  using(var node=(IDisposable)Activator.CreateInstance(type,new object[]{directory,null,null,0,0})){
   var local=type.GetMethod("Local");
   var info=(Dictionary<string,object>)local.Invoke(node,new object[]{new Dictionary<string,object>{{"action","info"}}});
   Require((string)info["id"]==expectedIdentity,"Startup changed device identity");
   Require(((string)info["bankId"]).Length==64,"Unbuilt question bank identifier");
   var listener=(TcpListener)type.GetField("localListener",BindingFlags.Instance|BindingFlags.NonPublic).GetValue(node);
   var url="http://127.0.0.1:"+((IPEndPoint)listener.LocalEndpoint).Port+"/";
   var request=(HttpWebRequest)WebRequest.Create(url);request.Proxy=null;request.Timeout=10000;
   using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream(),Encoding.UTF8)){
    var html=reader.ReadToEnd();Require(html.Contains("window.CPA_NATIVE_ENDPOINT="),"Native page bridge missing");
    Require(html.Contains((string)info["bankId"]),"Native page bank differs from transport");
   }
   using(var tcp=new TcpClient()){
    tcp.Connect(IPAddress.Loopback,Convert.ToInt32(info["port"]));tcp.ReceiveTimeout=8000;tcp.SendTimeout=8000;
    using(var stream=new SslStream(tcp.GetStream(),false,(sender,peer,chain,errors)=>{
     using(var remote=new X509Certificate2(peer))return Fingerprint(remote).Replace("-","").ToLowerInvariant()==expectedIdentity;
    })){
     stream.AuthenticateAsClient("CPA LAN",null,SslProtocols.Tls12,false);
     var bytes=Encoding.ASCII.GetBytes("GET /api/cpa/v1/info HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");stream.Write(bytes,0,bytes.Length);stream.Flush();
     using(var reader=new StreamReader(stream,Encoding.UTF8)){
      var response=reader.ReadToEnd();Require(response.StartsWith("HTTP/1.1 200 "),"Production TLS endpoint failed");
      Require(response.Contains(expectedIdentity),"Production TLS endpoint identity mismatch");
     }
    }
   }
  }
 }
 public static int Main(string[] args) {
  try {
   var app=Assembly.LoadFrom(Path.GetFullPath(args[0]));
   var directory=Path.GetFullPath(args[1]);Directory.CreateDirectory(directory);
   bool expectFailure=args.Length>2&&args[2]=="--expect-failure";
   X509Certificate2 first;
   try{first=Load(app,directory);}
   catch(Exception error){if(expectFailure){Console.WriteLine("REPRODUCED: "+error.Message);return 0;}throw;}
   using(first){
    Require(!expectFailure,"Old build unexpectedly generated its certificate");
    Require(first.HasPrivateKey,"Generated certificate has no private key");
    Require(first.Subject=="CN=CPA LAN","Certificate subject encoding mismatch");
    Require(File.Exists(Path.Combine(directory,"device.pfx")),"Certificate was not persisted");
    CheckTLS(first);var bytes=File.ReadAllBytes(Path.Combine(directory,"device.pfx"));
    using(var reopened=Load(app,directory)){
     Require(reopened.HasPrivateKey,"Reloaded certificate lost its private key");
     Require(Fingerprint(first)==Fingerprint(reopened),"Device identity changed after reopening");
     Require(Convert.ToBase64String(bytes)==Convert.ToBase64String(File.ReadAllBytes(Path.Combine(directory,"device.pfx"))),"Restart rewrote device identity");
     CheckTLS(reopened);
    }
    CheckStartup(app,directory,Fingerprint(first).Replace("-","").ToLowerInvariant());
    CheckStartup(app,directory,Fingerprint(first).Replace("-","").ToLowerInvariant());
   }
   Console.WriteLine("PASS: first-run certificate, private key, persisted identity, restart, TLS 1.2, native startup, HTTP page and production TLS endpoint after reopening");return 0;
  }catch(Exception error){Console.Error.WriteLine(error);return 1;}
 }
}
