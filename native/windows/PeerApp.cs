using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.NetworkInformation;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Runtime.InteropServices;

[assembly: System.Reflection.AssemblyVersion("3.2.1.1")]
[assembly: System.Reflection.AssemblyFileVersion("3.2.1.1")]
[assembly: System.Reflection.AssemblyProduct("CPA 刷题库 · 设备同步")]

public sealed class PeerApp : IDisposable {
 const int Port=53319, LocalPort=53320, Limit=25*1024*1024;
 const string Service="cpa-study-sync",Group="224.0.0.169",Bank="BANK_PLACEHOLDER";
 readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=2*Limit, RecursionLimit=100 };
 readonly object gate=new object();
 readonly Dictionary<string,Dictionary<string,object>> peers=new Dictionary<string,Dictionary<string,object>>();
 readonly Dictionary<string,Dictionary<string,object>> inbox=new Dictionary<string,Dictionary<string,object>>();
 readonly Dictionary<string,int> attempts=new Dictionary<string,int>();
 readonly string directory, id,alias,pin,localToken;
 readonly X509Certificate2 cert;
 Dictionary<string,object> published;
 TcpListener remoteListener,localListener;UdpClient udp;
 volatile bool running=true;
 string html;
 static Dictionary<string,object> Obj(object value){return value as Dictionary<string,object>;}
 static string Text(Dictionary<string,object> d,string k,string fallback=""){object v;return d!=null&&d.TryGetValue(k,out v)&&v!=null?Convert.ToString(v):fallback;}
 static int Number(Dictionary<string,object> d,string k,int fallback=0){int n;return int.TryParse(Text(d,k),out n)?n:fallback;}
 static Dictionary<string,object> D(params object[] pairs){var d=new Dictionary<string,object>();for(int i=0;i<pairs.Length;i+=2)d[(string)pairs[i]]=pairs[i+1];return d;}
 static string Hex(byte[] b){return BitConverter.ToString(b).Replace("-","").ToLowerInvariant();}
 static string Hash(string value){using(var h=SHA256.Create())return Hex(h.ComputeHash(Encoding.UTF8.GetBytes(value)));}
 static string RandomToken(){var b=new byte[32];using(var r=RandomNumberGenerator.Create())r.GetBytes(b);return Hex(b);}
 static bool Equal(string a,string b){if(a.Length!=b.Length)return false;int x=0;for(int i=0;i<a.Length;i++)x|=a[i]^b[i];return x==0;}
 public PeerApp(string dataDir,string testCert=null,string testHTML=null,int remotePort=Port,int localPort=LocalPort){
  directory=dataDir;Directory.CreateDirectory(directory);alias=Environment.MachineName;localToken=RandomToken();
  var bytes=new byte[4];using(var rng=RandomNumberGenerator.Create())rng.GetBytes(bytes);pin=(BitConverter.ToUInt32(bytes,0)%100000000).ToString("D8");
  cert=testCert==null?LoadCertificate():new X509Certificate2(testCert,"",X509KeyStorageFlags.Exportable);
  using(var h=SHA256.Create())id=Hex(h.ComputeHash(cert.RawData));
  if(testHTML!=null)html=File.ReadAllText(testHTML,Encoding.UTF8);
  else using(var s=typeof(PeerApp).Assembly.GetManifestResourceStream("CPAPeer.html.gz"))using(var gz=new GZipStream(s,CompressionMode.Decompress))using(var reader=new StreamReader(gz,Encoding.UTF8))html=reader.ReadToEnd();
  html=html.Replace("</head>","<script>window.CPA_NATIVE_ENDPOINT="+json.Serialize(D("token",localToken))+";</script></head>");
  Load();remoteListener=new TcpListener(IPAddress.Any,remotePort);remoteListener.Start();localListener=new TcpListener(IPAddress.Loopback,localPort);localListener.Start();
  Task.Run(()=>Accept(remoteListener,true));Task.Run(()=>Accept(localListener,false));
  try{udp=new UdpClient();udp.ExclusiveAddressUse=false;udp.Client.SetSocketOption(SocketOptionLevel.Socket,SocketOptionName.ReuseAddress,true);udp.Client.Bind(new IPEndPoint(IPAddress.Any,Port));udp.Ttl=1;
   foreach(var ip in LocalIPs())try{udp.JoinMulticastGroup(IPAddress.Parse(Group),ip);}catch{}
   Task.Run(()=>DiscoverReceive());Announce(true);
  }catch{if(udp!=null)udp.Close();udp=null;}
 }
 [StructLayout(LayoutKind.Sequential)] struct BLOB{public int size;public IntPtr data;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct KEY_PROVIDER{public string container,provider;public uint type,flags,count;public IntPtr parameters;public uint keySpec;}
 [StructLayout(LayoutKind.Sequential)] struct ALGORITHM{[MarshalAs(UnmanagedType.LPStr)]public string oid;public BLOB parameters;}
 [DllImport("crypt32.dll",SetLastError=true)] static extern IntPtr CertCreateSelfSignCertificate(IntPtr key,ref BLOB name,uint flags,ref KEY_PROVIDER provider,ref ALGORITHM algorithm,IntPtr start,IntPtr end,IntPtr extensions);
 // The W entry point takes UTF-16 even when the certificate subject is ASCII.
 [DllImport("crypt32.dll",SetLastError=true,CharSet=CharSet.Unicode,ExactSpelling=true)] static extern bool CertStrToNameW(uint encoding,string name,uint type,IntPtr reserved,byte[] output,ref uint length,IntPtr error);
 [DllImport("crypt32.dll")] static extern bool CertFreeCertificateContext(IntPtr cert);
 X509Certificate2 LoadCertificate(){
  string file=Path.Combine(directory,"device.pfx");if(File.Exists(file))return new X509Certificate2(file,"",X509KeyStorageFlags.PersistKeySet|X509KeyStorageFlags.Exportable);
  uint size=0;if(!CertStrToNameW(1,"CN=CPA LAN",3,IntPtr.Zero,null,ref size,IntPtr.Zero))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"无法编码设备证书名称");var name=new byte[size];
  if(!CertStrToNameW(1,"CN=CPA LAN",3,IntPtr.Zero,name,ref size,IntPtr.Zero))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"无法编码设备证书名称");
  // The native API's default key cannot be exported to our persisted device PFX.
  // Create an exportable user key, then reload the PFX before deleting the temporary container.
  var parameters=new CspParameters(24,null,"CPAStudyPeer-"+Guid.NewGuid().ToString("N")){KeyNumber=(int)KeyNumber.Exchange,Flags=CspProviderFlags.NoPrompt};
  using(var rsa=new RSACryptoServiceProvider(2048,parameters)){
   rsa.PersistKeyInCsp=false;rsa.ExportParameters(false);var info=rsa.CspKeyContainerInfo;
   var provider=new KEY_PROVIDER{container=info.KeyContainerName,provider=info.ProviderName,type=(uint)info.ProviderType,keySpec=(uint)info.KeyNumber};
   var algorithm=new ALGORITHM{oid="1.2.840.113549.1.1.11"};
   IntPtr buffer=Marshal.AllocHGlobal(name.Length);try{Marshal.Copy(name,0,buffer,name.Length);var blob=new BLOB{size=name.Length,data=buffer};IntPtr handle=CertCreateSelfSignCertificate(IntPtr.Zero,ref blob,0,ref provider,ref algorithm,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
    if(handle==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(),"设备证书生成失败");
    try{using(var value=new X509Certificate2(handle)){if(!value.HasPrivateKey)throw new Exception("设备证书缺少私钥");var pfx=value.Export(X509ContentType.Pfx,"");File.WriteAllBytes(file,pfx);return new X509Certificate2(pfx,"",X509KeyStorageFlags.PersistKeySet|X509KeyStorageFlags.Exportable);}}finally{CertFreeCertificateContext(handle);}
   }finally{Marshal.FreeHGlobal(buffer);}
  }
 }
 static IEnumerable<IPAddress> LocalIPs(){return NetworkInterface.GetAllNetworkInterfaces().Where(n=>n.OperationalStatus==OperationalStatus.Up).SelectMany(n=>n.GetIPProperties().UnicastAddresses).Select(a=>a.Address).Where(a=>a.AddressFamily==AddressFamily.InterNetwork&&!IPAddress.IsLoopback(a));}
 Dictionary<string,object> Info(){return D("service",Service,"version",1,"id",id,"alias",alias,"port",((IPEndPoint)remoteListener.LocalEndpoint).Port,"bankId",Bank);}
 void Load(){string file=Path.Combine(directory,"state.json");if(!File.Exists(file))return;var d=Obj(json.DeserializeObject(File.ReadAllText(file,Encoding.UTF8)));object[] ps;
  if(d.ContainsKey("peers")&&(ps=d["peers"] as object[])!=null)foreach(var v in ps){var p=Obj(v);peers[Text(p,"id")]=p;}
  if(d.ContainsKey("inbox")&&(ps=d["inbox"] as object[])!=null)foreach(var v in ps){var p=Obj(v);inbox[Text(p,"id")]=p;}
  if(d.ContainsKey("published"))published=Obj(d["published"]);
 }
 void Persist(){lock(gate){string file=Path.Combine(directory,"state.json"),tmp=Path.Combine(directory,"state.tmp");
  File.WriteAllText(tmp,json.Serialize(D("peers",peers.Values.Where(p=>p.ContainsKey("inToken")).ToArray(),"inbox",inbox.Values.ToArray(),"published",published)),new UTF8Encoding(false));
  if(File.Exists(file))File.Replace(tmp,file,Path.Combine(directory,"state.previous.json"));else File.Move(tmp,file);
 }}
 void Remember(Dictionary<string,object> value,string host){string pid=Text(value,"id");int port=Number(value,"port");IPAddress ip;
  if(pid.Length!=64||!pid.All(c=>"abcdef0123456789".Contains(c))||pid==id||port<1||port>65535||Text(value,"service")!=Service||!IPAddress.TryParse(host,out ip)||!Private(ip))return;
  lock(gate){Dictionary<string,object> p;if(!peers.TryGetValue(pid,out p)){p=D();peers[pid]=p;}p["id"]=pid;p["alias"]=Text(value,"alias","设备");p["host"]=host;p["port"]=port;p["bankId"]=Text(value,"bankId");}
 }
 static bool Private(IPAddress a){if(IPAddress.IsLoopback(a)||a.IsIPv6LinkLocal)return true;var b=a.GetAddressBytes();return b.Length==4&&(b[0]==10||b[0]==192&&b[1]==168||b[0]==172&&b[1]>=16&&b[1]<=31||b[0]==169&&b[1]==254);}
 void Announce(bool first){if(udp==null)return;try{var value=Info();value["announce"]=first;byte[] bytes=Encoding.UTF8.GetBytes(json.Serialize(value));foreach(var ip in LocalIPs())try{udp.Client.SetSocketOption(SocketOptionLevel.IP,SocketOptionName.MulticastInterface,ip.GetAddressBytes());udp.Send(bytes,bytes.Length,new IPEndPoint(IPAddress.Parse(Group),Port));}catch{}}catch{}}
 void DiscoverReceive(){while(running)try{var from=new IPEndPoint(IPAddress.Any,0);byte[] bytes=udp.Receive(ref from);if(bytes.Length>8192)continue;var value=Obj(json.DeserializeObject(Encoding.UTF8.GetString(bytes)));if(Text(value,"service")==Service&&Text(value,"id")!=id){Remember(value,from.Address.ToString());if(Text(value,"announce")=="True"||Text(value,"announce")=="true")Announce(false);}}catch{}}
 void Validate(Dictionary<string,object> wrapper){string payload=Text(wrapper,"payload");if(Encoding.UTF8.GetByteCount(payload)>Limit||Hash(payload)!=Text(wrapper,"hash"))throw new Exception("记录校验失败");var value=Obj(json.DeserializeObject(payload));if(Text(value,"schema")!="cpa-p2p-v1"||Text(value,"bankId")!=Bank)throw new Exception("题库或同步版本不一致");}
 void Receive(string pid,Dictionary<string,object> wrapper){if(wrapper==null)return;Validate(wrapper);lock(gate){Dictionary<string,object> old;inbox.TryGetValue(pid,out old);if(old!=null&&Text(old,"hash")==Text(wrapper,"hash"))return;
  var next=new Dictionary<string,object>(wrapper);next["id"]=pid;next["alias"]=Text(peers[pid],"alias");next["receivedAt"]=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();inbox[pid]=next;try{Persist();}catch{if(old==null)inbox.Remove(pid);else inbox[pid]=old;throw;}
 }}
 public Dictionary<string,object> Local(Dictionary<string,object> request){string action=Text(request,"action");
  if(action=="info"){var value=Info();value["pin"]=pin;value["ips"]=LocalIPs().Select(a=>a.ToString()).ToArray();return value;}
  if(action=="discover"){Announce(true);return D("ok",true);}
  if(action=="peers"){lock(gate)return D("peers",peers.Values.Select(p=>D("id",Text(p,"id"),"alias",Text(p,"alias"),"host",Text(p,"host"),"port",Number(p,"port"),"paired",p.ContainsKey("outToken"),"status",Text(p,"status"))).ToArray());}
  if(action=="manual"){string host=Text(request,"host");IPAddress ip;if(!IPAddress.TryParse(host,out ip)||!Private(ip))throw new Exception("请输入局域网 IP");var p=D("host",host,"port",Number(request,"port",Port));var value=Remote(p,"info",null,null);Remember(value,host);return value;}
  if(action=="pair"){Dictionary<string,object> p;lock(gate){if(!peers.TryGetValue(Text(request,"id"),out p))throw new Exception("设备尚未发现");}
   if(Text(p,"bankId")!=Bank)throw new Exception("题库版本不同，请更新两端");string back=RandomToken();var value=Remote(p,"pair",D("pin",Text(request,"pin"),"info",Info(),"backToken",back),null);
   lock(gate){p["inToken"]=back;p["outToken"]=Text(value,"token");Persist();}return D("ok",true);
  }
  if(action=="publish"){string payload=Text(request,"payload");var next=D("payload",payload,"hash",Hash(payload));Validate(next);lock(gate){var previous=published;published=next;try{Persist();}catch{published=previous;throw;}}return D("hash",Text(next,"hash"));}
  if(action=="exchange"){Dictionary<string,object>[] list;lock(gate)list=peers.Values.Where(p=>p.ContainsKey("outToken")).Select(p=>new Dictionary<string,object>(p)).ToArray();
   foreach(var p in list)try{Dictionary<string,object> own;lock(gate)own=published;var result=Remote(p,"sync",D("senderId",id,"snapshot",own),Text(p,"outToken"));Receive(Text(p,"id"),Obj(result["snapshot"]));lock(gate)if(peers.ContainsKey(Text(p,"id")))peers[Text(p,"id")]["status"]="已同步";
   }catch(Exception e){lock(gate)if(peers.ContainsKey(Text(p,"id")))peers[Text(p,"id")]["status"]="未连接："+e.Message;}
   lock(gate)return D("inbox",inbox.Values.ToArray());
  }
  if(action=="forget"){lock(gate){peers.Remove(Text(request,"id"));inbox.Remove(Text(request,"id"));Persist();}return D("ok",true);}
  throw new Exception("未知操作");
 }
 Dictionary<string,object> Handle(string path,string auth,Dictionary<string,object> req,string host){
  if(path=="/api/cpa/v1/info")return Info();
  if(path=="/api/cpa/v1/pair")lock(gate){int count;attempts.TryGetValue(host,out count);if(count>=5)throw new Exception("配对尝试过多，请重启接收端后重试");if(!Equal(pin,Text(req,"pin"))){attempts[host]=count+1;throw new Exception("配对码错误");}
   var identity=Obj(req["info"]);if(Text(identity,"bankId")!=Bank)throw new Exception("题库版本不同");string back=Text(req,"backToken");if(back.Length!=64||!back.All(c=>"abcdef0123456789".Contains(c)))throw new Exception("invalid token");
   Remember(identity,host);Dictionary<string,object> p;if(!peers.TryGetValue(Text(identity,"id"),out p))throw new Exception("invalid peer");string token=RandomToken();p["outToken"]=back;p["inToken"]=token;Persist();return D("token",token);
  }
  if(path!="/api/cpa/v1/sync")throw new Exception("not found");string pid=Text(req,"senderId");lock(gate){Dictionary<string,object> p;
   if(!peers.TryGetValue(pid,out p)||!p.ContainsKey("inToken")||!Equal("Bearer "+Text(p,"inToken"),auth))throw new Exception("尚未配对");p["host"]=host;Receive(pid,Obj(req["snapshot"]));return D("snapshot",published);
  }
 }
 static string Line(Stream s){var b=new MemoryStream();int c;while((c=s.ReadByte())!=-1&&c!=10){if(b.Length>8192)throw new Exception("header too large");if(c!=13)b.WriteByte((byte)c);}return c==-1&&b.Length==0?null:Encoding.UTF8.GetString(b.ToArray());}
 static byte[] ReadBody(Stream s,int size){if(size<0||size>2*Limit)throw new Exception("记录过大");var b=new byte[size];int n=0,r;while(n<size){r=s.Read(b,n,size-n);if(r<=0)throw new EndOfStreamException();n+=r;}return b;}
 void Accept(TcpListener listener,bool tls){while(running)try{var c=listener.AcceptTcpClient();Task.Run(()=>Serve(c,tls));}catch{}}
 void Serve(TcpClient client,bool tls){try{client.ReceiveTimeout=8000;client.SendTimeout=8000;Stream s=client.GetStream();
  if(tls){var ssl=new SslStream(s,false);ssl.AuthenticateAsServer(cert,false,System.Security.Authentication.SslProtocols.Tls12,false);s=ssl;}
  using(s){string first=Line(s);if(first==null)return;var words=first.Split(' ');if(words.Length<2)return;string path=words[1],host="",auth="",origin="",h;int length=0,total=0;
   while((h=Line(s))!=null&&h!=""){total+=h.Length;if(total>16384)throw new Exception("headers too large");int x=h.IndexOf(':');if(x<0)continue;string k=h.Substring(0,x).ToLowerInvariant(),v=h.Substring(x+1).Trim();if(k=="content-length")length=int.Parse(v);if(k=="authorization")auth=v;if(k=="host")host=v;if(k=="origin")origin=v;}
   string contentType="application/json; charset=utf-8";byte[] bytes;int status=200;
   try{
    if(!tls&&(host!="127.0.0.1:"+((IPEndPoint)localListener.LocalEndpoint).Port||origin!=""&&origin!="http://"+host))throw new Exception("请求来源不匹配");
    if(!tls&&(path=="/"||path=="/index.html")){bytes=Encoding.UTF8.GetBytes(html);contentType="text/html; charset=utf-8";}
    else {var req=length>0?Obj(json.DeserializeObject(Encoding.UTF8.GetString(ReadBody(s,length)))):D();
     Dictionary<string,object> value;if(tls)value=Handle(path,auth,req,((IPEndPoint)client.Client.RemoteEndPoint).Address.ToString());
     else {if(path!="/local"||words[0]!="POST"||!Equal(auth,"Bearer "+localToken))throw new Exception("无效的本机请求");value=Local(req);}
     bytes=Encoding.UTF8.GetBytes(json.Serialize(D("ok",true,"result",value)));
     // Peer protocol responses do not use the native bridge envelope.
     if(tls)bytes=Encoding.UTF8.GetBytes(json.Serialize(value));
    }
   }catch(Exception e){status=400;bytes=Encoding.UTF8.GetBytes(json.Serialize(D("ok",false,"error",e.Message)));}
   byte[] header=Encoding.UTF8.GetBytes("HTTP/1.1 "+status+" Result\r\nContent-Type: "+contentType+"\r\nContent-Length: "+bytes.Length+"\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: frame-ancestors 'none'\r\nConnection: close\r\n\r\n");s.Write(header,0,header.Length);s.Write(bytes,0,bytes.Length);s.Flush();
  }
 }catch{}finally{client.Close();}}
 Dictionary<string,object> Remote(Dictionary<string,object> peer,string action,Dictionary<string,object> req,string token){string expected=Text(peer,"id"),actual=null;
  using(var tcp=new TcpClient()){var connect=tcp.BeginConnect(Text(peer,"host"),Number(peer,"port"),null,null);if(!connect.AsyncWaitHandle.WaitOne(2500))throw new Exception("连接超时");tcp.EndConnect(connect);tcp.ReceiveTimeout=5000;tcp.SendTimeout=5000;
   using(var s=new SslStream(tcp.GetStream(),false,(sender,certificate,chain,errors)=>{using(var h=SHA256.Create())actual=Hex(h.ComputeHash(certificate.GetRawCertData()));return expected==""||actual==expected;})){
    s.AuthenticateAsClient(Text(peer,"host"),null,System.Security.Authentication.SslProtocols.Tls12,false);byte[] b=req==null?new byte[0]:Encoding.UTF8.GetBytes(json.Serialize(req));
    string header=(req==null?"GET":"POST")+" /api/cpa/v1/"+action+" HTTP/1.1\r\nHost: "+Text(peer,"host")+"\r\nContent-Type: application/json\r\nContent-Length: "+b.Length+"\r\nConnection: close\r\n"+(token==null?"":"Authorization: Bearer "+token+"\r\n")+"\r\n";
    var head=Encoding.UTF8.GetBytes(header);s.Write(head,0,head.Length);s.Write(b,0,b.Length);s.Flush();string status=Line(s),line;int size=-1;
    while((line=Line(s))!=null&&line!="")if(line.ToLowerInvariant().StartsWith("content-length:"))size=int.Parse(line.Substring(15).Trim());
    var value=Obj(json.DeserializeObject(Encoding.UTF8.GetString(ReadBody(s,size))));if(status==null||!status.Contains(" 200 "))throw new Exception(Text(value,"error","连接失败"));if(action=="info"&&actual!=Text(value,"id"))throw new Exception("设备标识与证书不符");return value;
   }
  }
 }
 public void Dispose(){running=false;if(remoteListener!=null)remoteListener.Stop();if(localListener!=null)localListener.Stop();if(udp!=null)udp.Close();cert.Dispose();}
 [STAThread] public static void Main(string[] args){
  try{
   if(args.Length>=3&&args[0]=="--test"){using(var node=new PeerApp(args[1],args[2],args.Length>3?args[3]:null,args.Length>4?int.Parse(args[4]):Port,args.Length>5?int.Parse(args[5]):LocalPort)){Console.WriteLine(node.json.Serialize(node.Local(D("action","info"))));Console.WriteLine(node.localToken);Console.Out.Flush();Thread.Sleep(Timeout.Infinite);}return;}
   if(args.Length==2&&args[0]=="--extract"){using(var s=typeof(PeerApp).Assembly.GetManifestResourceStream("CPAPeer.html.gz"))using(var gz=new GZipStream(s,CompressionMode.Decompress))using(var o=File.Create(args[1]))gz.CopyTo(o);return;}
   bool created;using(var mutex=new Mutex(true,"CPAStudyPeerAppV1",out created)){if(!created){System.Diagnostics.Process.Start("http://127.0.0.1:"+LocalPort+"/");return;}
    Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
    using(var node=new PeerApp(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CPAStudyPeer"))){
     var form=new Form{Text="CPA 刷题库 · 设备直连",Width=470,Height=270,StartPosition=FormStartPosition.CenterScreen};
     var label=new Label{Left=20,Top=20,Width=420,Height=120,Text="设备："+node.alias+"\n首次配对码："+node.pin+"\n打开手机 APK 的设备同步页，即可发现本机。\n程序内置通信功能，请保持此窗口打开。"};
     var open=new Button{Left=20,Top=150,Width=160,Text="打开刷题页面"};open.Click+=(s,e)=>System.Diagnostics.Process.Start("http://127.0.0.1:"+LocalPort+"/");
     form.Controls.Add(label);form.Controls.Add(open);form.Shown+=(s,e)=>System.Diagnostics.Process.Start("http://127.0.0.1:"+LocalPort+"/");Application.Run(form);
    }
   }
  }catch(Exception e){var socket=e as SocketException;string hint=socket!=null&&socket.SocketErrorCode==SocketError.AddressAlreadyInUse?"\n请退出旧的刷题直连程序后重试。":"";MessageBox.Show(e.Message+hint,"CPA 刷题库");}
 }
}
