using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Net;
using System.Windows.Forms;

ApplicationConfiguration.Initialize();
using var tray = new TrayApplicationContext();
Application.Run(tray);

internal sealed class TrayApplicationContext : ApplicationContext
{
    private const string DashboardUrl = "http://127.0.0.1:8787";
    private readonly NotifyIcon icon;
    private readonly ContextMenuStrip menu;

    public TrayApplicationContext()
    {
        menu = new ContextMenuStrip();
        menu.Items.Add("Öppna adminpanel", null, (_, _) => OpenDashboard());
        menu.Items.Add("Starta om adminpanel", null, (_, _) => RestartDashboard());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Avsluta", null, (_, _) => ExitThread());

        icon = new NotifyIcon
        {
            Icon = CreateIcon(),
            Text = "Serviceresor adminpanel",
            Visible = true,
            ContextMenuStrip = menu
        };
        icon.DoubleClick += (_, _) => OpenDashboard();
        icon.BalloonTipTitle = "Serviceresor adminpanel";
        icon.BalloonTipText = "Högerklicka för att öppna menyn.";
    }

    private static void OpenDashboard()
    {
        Process.Start(new ProcessStartInfo(DashboardUrl) { UseShellExecute = true });
    }

    private static void RestartDashboard()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -NonInteractive -Command \"Start-ScheduledTask -TaskName 'Serviceresor admin dashboard'\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        });
        OpenDashboard();
    }

    protected override void ExitThreadCore()
    {
        icon.Visible = false;
        icon.Dispose();
        menu.Dispose();
        base.ExitThreadCore();
    }

    private static Icon CreateIcon()
    {
        using var bitmap = new Bitmap(32, 32);
        using (var graphics = Graphics.FromImage(bitmap))
        using (var brush = new SolidBrush(Color.FromArgb(239, 107, 50)))
        using (var textBrush = new SolidBrush(Color.FromArgb(21, 39, 32)))
        using (var font = new Font("Arial", 9, FontStyle.Bold, GraphicsUnit.Pixel))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.FillEllipse(brush, 1, 1, 30, 30);
            graphics.DrawString("SR", font, textBrush, 5, 10);
        }

        return Icon.FromHandle(bitmap.GetHicon());
    }
}
