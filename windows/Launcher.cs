using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("CPA刷题库 Windows离线版")]
[assembly: AssemblyDescription("六科题库，练习历史，自动保存并恢复上次作答")]
[assembly: AssemblyVersion("1.2.0.0")]

internal static class Launcher
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            // Keep the old launcher's file path, so existing browser data survives.
            string target = Path.Combine(Path.GetTempPath(), "CPA_Accounting_Offline.html");
            bool extractOnly = args.Length == 2 && args[0] == "--extract";
            if (extractOnly) target = Path.GetFullPath(args[1]);
            using (Stream payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("CPAOffline.html.gz"))
            using (GZipStream decoded = new GZipStream(payload, CompressionMode.Decompress))
            using (FileStream file = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.Read))
            {
                decoded.CopyTo(file);
            }
            if (!extractOnly) Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show("无法打开离线题库：" + error.Message, "CPA刷题库", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
