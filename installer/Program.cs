using System.Diagnostics;
using System.Text;
using System.Text.Json;

const string product = "Serviceresor Live Tracking";
Console.OutputEncoding = Encoding.UTF8;

void Header(string text)
{
    Console.Clear();
    Console.ForegroundColor = ConsoleColor.DarkGreen;
    Console.WriteLine("========================================");
    Console.WriteLine($"  {product}");
    Console.WriteLine("========================================");
    Console.ResetColor();
    Console.WriteLine();
    Console.WriteLine(text);
    Console.WriteLine();
}

string ReadText(string prompt, string? current = null)
{
    Console.Write(current is null ? $"{prompt}: " : $"{prompt} [Enter behåller befintligt]: ");
    var value = Console.ReadLine()?.Trim() ?? string.Empty;
    return string.IsNullOrEmpty(value) && current is not null ? current : value;
}

string ReadSecret(string prompt, string? current = null)
{
    Console.Write(current is null ? $"{prompt}: " : $"{prompt} [Enter behåller befintligt]: ");
    var value = new StringBuilder();
    while (true)
    {
        var key = Console.ReadKey(intercept: true);
        if (key.Key == ConsoleKey.Enter) break;
        if (key.Key == ConsoleKey.Backspace && value.Length > 0)
        {
            value.Length--;
            Console.Write("\b \b");
            continue;
        }
        if (!char.IsControl(key.KeyChar))
        {
            value.Append(key.KeyChar);
            Console.Write('*');
        }
    }
    Console.WriteLine();
    return value.Length == 0 && current is not null ? current : value.ToString();
}

void CheckCommand(string command, string name, string installHint)
{
    var result = RunProcess(command, "--version", null);
    if (result.ExitCode != 0) throw new InvalidOperationException($"{name} saknas. Installera först: {installHint}");
    Console.WriteLine($"  [OK] {name}");
}

(string Output, int ExitCode) RunProcess(string file, string arguments, Dictionary<string, string>? environment)
{
    var start = new ProcessStartInfo
    {
        FileName = file,
        Arguments = arguments,
        WorkingDirectory = Directory.GetCurrentDirectory(),
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true
    };
    if (environment is not null)
    {
        foreach (var item in environment) start.Environment[item.Key] = item.Value;
    }
    using var process = Process.Start(start) ?? throw new InvalidOperationException($"Kunde inte starta {file}.");
    var output = process.StandardOutput.ReadToEnd();
    var error = process.StandardError.ReadToEnd();
    process.WaitForExit();
    return ($"{output}{error}", process.ExitCode);
}

try
{
    Header("Välkommen. Guiden kontrollerar datorn och installerar tjänsten.");
    Console.WriteLine("Lokala tjänstevärden sparas i .env.local.json. Filen ignoreras av Git.");
    Console.WriteLine("Lämna valfria fält tomma om integrationen inte ska användas.");

    var project = Directory.GetCurrentDirectory();
    var setupScript = Path.Combine(project, "setup-app.ps1");
    var environmentFile = Path.Combine(project, ".env.local.json");
    if (!File.Exists(setupScript)) throw new FileNotFoundException("setup-app.ps1 hittades inte. Kör exe-filen från projektmappen.");

    Header("Steg 1 av 4 · Kontrollerar krav");
    CheckCommand("node.exe", "Node.js", "https://nodejs.org/");
    CheckCommand("npm.cmd", "npm", "https://nodejs.org/");
    CheckCommand("git.exe", "Git", "https://git-scm.com/download/win");
    CheckCommand("dotnet.exe", ".NET", "https://dotnet.microsoft.com/download");
    var chrome = new[]
    {
        @"C:\Program Files\Google\Chrome\Application\chrome.exe",
        @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    }.FirstOrDefault(File.Exists);
    if (chrome is null) throw new InvalidOperationException("Google Chrome hittades inte.");
    Console.WriteLine("  [OK] Google Chrome");

    var values = File.Exists(environmentFile)
        ? JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(environmentFile)) ?? new()
        : new Dictionary<string, string>();
    string? Existing(string name) => values.TryGetValue(name, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;
    void Save(string name, string value)
    {
        if (string.IsNullOrWhiteSpace(value)) values.Remove(name);
        else values[name] = value;
    }

    Header("Steg 2 av 4 · Lokal adminpanel");
    var adminPassword = ReadSecret("Adminlösenord, minst 12 tecken", Existing("ADMIN_DASHBOARD_PASSWORD"));
    if (adminPassword.Length < 12) throw new InvalidOperationException("Adminlösenordet måste ha minst 12 tecken.");
    Save("ADMIN_DASHBOARD_PASSWORD", adminPassword);

    Header("Steg 3 av 4 · Lokala integrationer");
    Save("HERENOW_API_KEY", ReadSecret("here.now API-nyckel", Existing("HERENOW_API_KEY")));
    Save("ELKS_API_USERNAME", ReadText("46elks API-användarnamn", Existing("ELKS_API_USERNAME")));
    Save("ELKS_API_PASSWORD", ReadSecret("46elks API-lösenord", Existing("ELKS_API_PASSWORD")));
    Save("TEXTBEE_API_KEY", ReadSecret("TextBee API-nyckel", Existing("TEXTBEE_API_KEY")));
    Save("TEXTBEE_DEVICE_ID", ReadText("TextBee enhets-ID", Existing("TEXTBEE_DEVICE_ID")));
    Save("TEXTBEE_BASE_URL", ReadText("TextBee bas-URL", Existing("TEXTBEE_BASE_URL") ?? "https://api.textbee.dev/api/v1"));
    Save("NTFY_SERVER_URL", ReadText("ntfy server-URL", Existing("NTFY_SERVER_URL") ?? "https://ntfy.sh"));
    Save("NTFY_ACCESS_TOKEN", ReadSecret("ntfy access-token", Existing("NTFY_ACCESS_TOKEN")));

    File.WriteAllText(environmentFile, JsonSerializer.Serialize(values, new JsonSerializerOptions { WriteIndented = true }) + Environment.NewLine);

    Header("Steg 4 av 4 · Installerar");
    var powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
    var arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{setupScript}\"";
    var result = RunProcess(powershell, arguments, values);
    if (result.ExitCode != 0) throw new InvalidOperationException(result.Output);

    Console.ForegroundColor = ConsoleColor.Green;
    Console.WriteLine("\nInstallation klar.");
    Console.ResetColor();
    Console.WriteLine("Öppna http://127.0.0.1:8787 för adminpanelen.");
    Console.WriteLine("Fyll i users.local.json med Serviceresor-användare och mottagare.");
    Console.WriteLine("Tryck Enter för att avsluta.");
    Console.ReadLine();
}
catch (Exception error)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine($"\nInstallationen misslyckades: {error.Message}");
    Console.ResetColor();
    Console.WriteLine("Se README.md för manuell installation.");
    Console.WriteLine("Tryck Enter för att avsluta.");
    Console.ReadLine();
    Environment.ExitCode = 1;
}
