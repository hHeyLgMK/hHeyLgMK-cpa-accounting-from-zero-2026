package cn.cpa26.workbook;

import org.json.*;
import javax.net.ssl.*;
import java.net.*;
import java.io.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.*;
import java.util.concurrent.*;

/** App-owned discovery and certificate-pinned HTTPS transport, no external service. */
public final class PeerNode {
    public static final String SERVICE="cpa-study-sync", GROUP="224.0.0.169";
    public static final int DISCOVERY_PORT=53319, LIMIT=25*1024*1024;
    final SSLContext serverTLS; final File root; final String id, alias, bankId;
    final int port; final String pin;
    final Map<String,JSONObject> peers=new ConcurrentHashMap<String,JSONObject>();
    final Map<String,JSONObject> inbox=new ConcurrentHashMap<String,JSONObject>();
    final Map<String,Integer> attempts=new ConcurrentHashMap<String,Integer>();
    final ExecutorService workers=Executors.newFixedThreadPool(6);
    volatile boolean running=true; volatile JSONObject published;
    SSLServerSocket listener; MulticastSocket multicast;

    public PeerNode(SSLContext context,String fingerprint,File directory,String name,String bank,int requestedPort) throws Exception {
        serverTLS=context;id=fingerprint;root=directory;alias=name;bankId=bank;
        root.mkdirs();
        pin=String.format(Locale.US,"%08d",new SecureRandom().nextInt(100000000));
        listener=(SSLServerSocket)serverTLS.getServerSocketFactory().createServerSocket(requestedPort);
        listener.setEnabledProtocols(new String[]{"TLSv1.2"});port=listener.getLocalPort();
        load();
        workers.execute(new Runnable(){public void run(){while(running)try{
            final Socket s=listener.accept();workers.execute(new Runnable(){public void run(){serve(s);}});
        }catch(Exception e){if(running)try{Thread.sleep(100);}catch(Exception ignored){}}}});
        try {
            multicast=new MulticastSocket(null);multicast.setReuseAddress(true);multicast.bind(new InetSocketAddress(DISCOVERY_PORT));multicast.setTimeToLive(1);
            Enumeration<NetworkInterface> interfaces=NetworkInterface.getNetworkInterfaces();
            while(interfaces.hasMoreElements()) {
                NetworkInterface n=interfaces.nextElement();
                try { if(n.isUp()&&!n.isLoopback())multicast.joinGroup(new InetSocketAddress(GROUP,DISCOVERY_PORT),n); } catch(Exception ignored){}
            }
            workers.execute(new Runnable(){public void run(){byte[] b=new byte[8192];while(running)try{
                DatagramPacket packet=new DatagramPacket(b,b.length);multicast.receive(packet);
                JSONObject value=new JSONObject(new String(packet.getData(),0,packet.getLength(),"UTF-8"));
                if(SERVICE.equals(value.optString("service"))&&!id.equals(value.optString("id"))) {
                    remember(value,packet.getAddress().getHostAddress());
                    if(value.optBoolean("announce"))announce(false);
                }
            }catch(Exception ignored){}}});
        } catch(Exception ignored){multicast=null;}
        announce(true);
    }
    static String hash(String s)throws Exception{return hex(MessageDigest.getInstance("SHA-256").digest(s.getBytes("UTF-8")));}
    public static String hex(byte[] b){StringBuilder s=new StringBuilder();for(byte x:b)s.append(String.format(Locale.US,"%02x",x&255));return s.toString();}
    public JSONObject info()throws Exception{return new JSONObject().put("service",SERVICE).put("version",1).put("id",id).put("alias",alias).put("port",port).put("bankId",bankId);}
    public JSONObject localInfo()throws Exception {
        JSONArray ips=new JSONArray();Enumeration<NetworkInterface> ns=NetworkInterface.getNetworkInterfaces();
        while(ns.hasMoreElements()){Enumeration<InetAddress> as=ns.nextElement().getInetAddresses();while(as.hasMoreElements()){InetAddress a=as.nextElement();if(a instanceof Inet4Address&&!a.isLoopbackAddress())ips.put(a.getHostAddress());}}
        return info().put("pin",pin).put("ips",ips);
    }
    void remember(JSONObject value,String host)throws Exception {
        String pid=value.optString("id");int pp=value.optInt("port");
        if(!pid.matches("[a-f0-9]{64}")||id.equals(pid)||pp<1||pp>65535||!SERVICE.equals(value.optString("service")))return;
        InetAddress address=InetAddress.getByName(host);
        if(!address.isSiteLocalAddress()&&!address.isLoopbackAddress()&&!address.isLinkLocalAddress())return;
        JSONObject p=peers.get(pid);if(p==null){p=new JSONObject();peers.put(pid,p);}
        synchronized(p){p.put("id",pid).put("host",host).put("port",pp).put("alias",value.optString("alias","设备")).put("bankId",value.optString("bankId")).put("seen",System.currentTimeMillis());}
    }
    void announce(boolean first){if(multicast==null)return;try{
        byte[] b=info().put("announce",first).toString().getBytes("UTF-8");
        Enumeration<NetworkInterface> ns=NetworkInterface.getNetworkInterfaces();
        while(ns.hasMoreElements()){NetworkInterface n=ns.nextElement();try{if(n.isUp()&&!n.isLoopback()){multicast.setNetworkInterface(n);multicast.send(new DatagramPacket(b,b.length,InetAddress.getByName(GROUP),DISCOVERY_PORT));}}catch(Exception ignored){}}
    }catch(Exception ignored){}}
    synchronized void persist()throws Exception {
        JSONObject state=new JSONObject();JSONArray ps=new JSONArray();for(JSONObject p:peers.values())if(p.has("inToken"))ps.put(p);
        state.put("peers",ps).put("published",published==null?JSONObject.NULL:published);
        JSONArray messages=new JSONArray();for(JSONObject p:inbox.values())messages.put(p);state.put("inbox",messages);
        File tmp=new File(root,"state.tmp"),dst=new File(root,"state.json");
        FileOutputStream out=new FileOutputStream(tmp);out.write(state.toString().getBytes("UTF-8"));out.getFD().sync();out.close();
        if(dst.exists()){File old=new File(root,"state.previous.json");if(old.exists())old.delete();if(!dst.renameTo(old))throw new IOException("无法备份记录");}
        if(!tmp.renameTo(dst))throw new IOException("无法保存同步记录");
    }
    void load()throws Exception {File f=new File(root,"state.json");if(!f.exists())return;
        JSONObject state=new JSONObject(readFile(f));JSONArray ps=state.optJSONArray("peers");
        if(ps!=null)for(int i=0;i<ps.length();i++){JSONObject p=ps.getJSONObject(i);peers.put(p.getString("id"),p);}
        published=state.optJSONObject("published");JSONArray ms=state.optJSONArray("inbox");
        if(ms!=null)for(int i=0;i<ms.length();i++){JSONObject p=ms.getJSONObject(i);inbox.put(p.getString("id"),p);}
    }
    static String readFile(File file)throws Exception {FileInputStream in=new FileInputStream(file);byte[] b=new byte[(int)file.length()];try{int n=0,r;while(n<b.length&&(r=in.read(b,n,b.length-n))>0)n+=r;return new String(b,0,n,"UTF-8");}finally{in.close();}}
    void validate(JSONObject wrapper)throws Exception {
        String payload=wrapper.getString("payload");if(payload.getBytes("UTF-8").length>LIMIT||!hash(payload).equals(wrapper.getString("hash")))throw new IOException("记录校验失败");
        JSONObject value=new JSONObject(payload);
        if(!"cpa-p2p-v1".equals(value.optString("schema"))||!bankId.equals(value.optString("bankId")))throw new IOException("题库或同步版本不一致");
    }
    synchronized void receive(String pid,JSONObject wrapper)throws Exception {
        if(wrapper==null)return;validate(wrapper);
        JSONObject old=inbox.get(pid);if(old!=null&&old.optString("hash").equals(wrapper.getString("hash")))return;
        JSONObject next=new JSONObject(wrapper.toString()).put("id",pid).put("alias",peers.get(pid).optString("alias")).put("receivedAt",System.currentTimeMillis());
        inbox.put(pid,next);try{persist();}catch(Exception e){if(old==null)inbox.remove(pid);else inbox.put(pid,old);throw e;}
    }
    String randomToken(){byte[] b=new byte[32];new SecureRandom().nextBytes(b);return hex(b);}
    public JSONObject local(JSONObject request)throws Exception {
        String action=request.getString("action");
        if("info".equals(action))return localInfo();
        if("peers".equals(action)){JSONArray a=new JSONArray();for(JSONObject p:peers.values())a.put(new JSONObject().put("id",p.getString("id")).put("alias",p.optString("alias")).put("host",p.getString("host")).put("port",p.getInt("port")).put("paired",p.has("outToken")).put("status",p.optString("status")));return new JSONObject().put("peers",a);}
        if("discover".equals(action)){announce(true);return new JSONObject().put("ok",true);}
        if("manual".equals(action)) {
            String host=request.getString("host");InetAddress address=InetAddress.getByName(host);
            if(!address.isSiteLocalAddress()&&!address.isLoopbackAddress()&&!address.isLinkLocalAddress())throw new IOException("请输入局域网 IP");
            JSONObject p=new JSONObject().put("host",host).put("port",request.optInt("port",DISCOVERY_PORT));
            JSONObject value=remote(p,"info",null,null);remember(value,host);return value;
        }
        if("pair".equals(action)){
            JSONObject p=peers.get(request.getString("id"));if(p==null)throw new IOException("设备尚未发现");
            if(!bankId.equals(p.optString("bankId")))throw new IOException("题库版本不同，请更新两端");
            String back=randomToken();JSONObject value=remote(p,"pair",new JSONObject().put("pin",request.getString("pin")).put("info",info()).put("backToken",back),null);
            p.put("inToken",back).put("outToken",value.getString("token"));persist();return new JSONObject().put("ok",true);
        }
        if("publish".equals(action)){
            String payload=request.getString("payload");JSONObject next=new JSONObject().put("hash",hash(payload)).put("payload",payload);validate(next);
            JSONObject previous=published;published=next;try{persist();}catch(Exception e){published=previous;throw e;}return new JSONObject().put("hash",next.getString("hash"));
        }
        if("exchange".equals(action)){
            for(JSONObject p:new ArrayList<JSONObject>(peers.values()))if(p.has("outToken"))try{
                JSONObject result=remote(p,"sync",new JSONObject().put("senderId",id).put("snapshot",published==null?JSONObject.NULL:published),p.getString("outToken"));
                receive(p.getString("id"),result.optJSONObject("snapshot"));p.put("status","已同步");
            }catch(Exception e){p.put("status","未连接："+e.getMessage());}
            JSONArray a=new JSONArray();for(JSONObject p:inbox.values())a.put(p);return new JSONObject().put("inbox",a);
        }
        if("forget".equals(action)){peers.remove(request.getString("id"));inbox.remove(request.getString("id"));persist();return new JSONObject().put("ok",true);}
        throw new IOException("未知操作");
    }
    static String line(InputStream in)throws IOException {ByteArrayOutputStream out=new ByteArrayOutputStream();int b;while((b=in.read())!=-1&&b!=10){if(out.size()>8192)throw new IOException("header too large");if(b!=13)out.write(b);}if(b==-1&&out.size()==0)return null;return out.toString("UTF-8");}
    static byte[] body(InputStream in,int size)throws IOException {if(size<0||size>2*LIMIT)throw new IOException("记录过大");byte[] b=new byte[size];int n=0,r;while(n<size){r=in.read(b,n,size-n);if(r<0)throw new EOFException();n+=r;}return b;}
    void serve(Socket s){try{
        s.setSoTimeout(8000);InputStream in=s.getInputStream();String first=line(in);if(first==null)return;
        String[] parts=first.split(" ");if(parts.length<2)return;String path=parts[1];int length=0;String auth="";String h;int total=0;
        while((h=line(in))!=null&&!h.isEmpty()){total+=h.length();if(total>16384)throw new IOException("headers too large");int x=h.indexOf(':');if(x>0){String key=h.substring(0,x).toLowerCase(Locale.US),v=h.substring(x+1).trim();if(key.equals("content-length"))length=Integer.parseInt(v);if(key.equals("authorization"))auth=v;}}
        JSONObject req=length>0?new JSONObject(new String(body(in,length),"UTF-8")):new JSONObject();JSONObject value;int status=200;
        try {value=handle(path,auth,req,s.getInetAddress().getHostAddress());}
        catch(SecurityException e){status=403;value=new JSONObject().put("error",e.getMessage());}
        catch(Exception e){status=400;value=new JSONObject().put("error",e.getMessage()==null?"记录无效":e.getMessage());}
        byte[] b=value.toString().getBytes("UTF-8");OutputStream out=s.getOutputStream();out.write(("HTTP/1.1 "+status+" Result\r\nContent-Type: application/json\r\nContent-Length: "+b.length+"\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));out.write(b);out.flush();
    }catch(Exception ignored){}finally{try{s.close();}catch(Exception ignored){}}}
    synchronized JSONObject handle(String path,String auth,JSONObject req,String host)throws Exception {
        if(path.equals("/api/cpa/v1/info"))return info();
        if(path.equals("/api/cpa/v1/pair")){
            int count=attempts.containsKey(host)?attempts.get(host):0;if(count>=5)throw new SecurityException("配对尝试过多，请重启接收端后重试");
            if(!MessageDigest.isEqual(pin.getBytes("UTF-8"),req.optString("pin").getBytes("UTF-8"))){attempts.put(host,count+1);throw new SecurityException("配对码错误");}
            JSONObject identity=req.getJSONObject("info");if(!bankId.equals(identity.optString("bankId")))throw new IOException("题库版本不同");
            String back=req.getString("backToken");if(!back.matches("[a-f0-9]{64}"))throw new SecurityException("invalid token");
            remember(identity,host);JSONObject p=peers.get(identity.getString("id"));if(p==null)throw new SecurityException("invalid peer");
            String token=randomToken();p.put("outToken",back).put("inToken",token);persist();return new JSONObject().put("token",token);
        }
        if(!path.equals("/api/cpa/v1/sync"))throw new IOException("not found");
        String pid=req.optString("senderId");JSONObject p=peers.get(pid);
        if(p==null||!p.has("inToken")||!MessageDigest.isEqual(("Bearer "+p.getString("inToken")).getBytes("UTF-8"),auth.getBytes("UTF-8")))throw new SecurityException("尚未配对");
        p.put("host",host);receive(pid,req.optJSONObject("snapshot"));return new JSONObject().put("snapshot",published==null?JSONObject.NULL:published);
    }
    JSONObject remote(JSONObject peer,String action,JSONObject req,String token)throws Exception {
        final String expected=peer.optString("id");final String[] actual={null};
        SSLContext ctx=SSLContext.getInstance("TLS");ctx.init(null,new TrustManager[]{new X509TrustManager(){public X509Certificate[] getAcceptedIssuers(){return new X509Certificate[0];}public void checkClientTrusted(X509Certificate[] c,String a){}public void checkServerTrusted(X509Certificate[] c,String a)throws java.security.cert.CertificateException{try{
            actual[0]=hex(MessageDigest.getInstance("SHA-256").digest(c[0].getEncoded()));if(!expected.isEmpty()&&!expected.equals(actual[0]))throw new java.security.cert.CertificateException("设备证书已变化，请重新配对");
        }catch(Exception e){throw new java.security.cert.CertificateException(e);}}}},new SecureRandom());
        SSLSocket s=(SSLSocket)ctx.getSocketFactory().createSocket();s.connect(new InetSocketAddress(peer.getString("host"),peer.getInt("port")),2500);s.setSoTimeout(5000);s.setEnabledProtocols(new String[]{"TLSv1.2"});
        try {s.startHandshake();byte[] b=req==null?new byte[0]:req.toString().getBytes("UTF-8");OutputStream out=s.getOutputStream();
            String header=(req==null?"GET":"POST")+" /api/cpa/v1/"+action+" HTTP/1.1\r\nHost: "+peer.getString("host")+"\r\nContent-Type: application/json\r\nContent-Length: "+b.length+"\r\nConnection: close\r\n"+(token==null?"":"Authorization: Bearer "+token+"\r\n")+"\r\n";
            out.write(header.getBytes("UTF-8"));out.write(b);out.flush();InputStream in=s.getInputStream();String status=line(in),h;int size=-1;
            while((h=line(in))!=null&&!h.isEmpty())if(h.toLowerCase(Locale.US).startsWith("content-length:"))size=Integer.parseInt(h.substring(15).trim());
            JSONObject value=new JSONObject(new String(body(in,size),"UTF-8"));if(status==null||!status.contains(" 200 "))throw new IOException(value.optString("error","连接失败"));
            if(action.equals("info")&&!actual[0].equals(value.optString("id")))throw new SecurityException("设备标识与证书不符");return value;
        }finally{s.close();}
    }
    public void close(){running=false;try{listener.close();}catch(Exception ignored){}if(multicast!=null)multicast.close();workers.shutdownNow();}
}
