using System.Diagnostics;
using System.Security;

const string product = "Serviceresor Live Tracking";
Console.OutputEncoding = System.Text.Encoding.UTF8;

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

string ReadSecret(string prompt)
{
    Console.Write(prompt);
    var value = new System.Text.StringBuilder();
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
    return value.ToString();
}

void CheckCommand(string command, string name, string installHint)
{
    var result = RunProcess(command, "--version", null, false);
    if (result.ExitCode != 0)
    {
        throw new InvalidOperationException($"{name} saknas. Installera först: {installHint}");
    }
    Console.WriteLine($"  [OK] {name}");
}

(string Output, int ExitCode) RunProcess(string file, string arguments, Dictionary<string, string>? environment, bool showWindow)
{
    var start = new ProcessStartInfo
    {
        FileName = file,
        Arguments = arguments,
        WorkingDirectory = Directory.GetCurrentDirectory(),
        UseShellExecute = false,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = !showWindow
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
    Console.WriteLine("Installationen ändrar endast den valda projektmappen och Windows schemalagda uppgifter.");
    Console.WriteLine("Tjänsteuppgifter för Serviceresor, here.now, SMS och ntfy frågas aldrig efter av denna guide.");
    Console.WriteLine();

    var project = Directory.GetCurrentDirectory();
    Console.WriteLine($"Projektmapp: {project}");
    if (!File.Exists(Path.Combine(project, "install.ps1")))
    {
        throw new FileNotFoundException("install.ps1 hittades inte. Kör exe-filen från projektmappen.");
    }

    Header("Steg 1 av 3 · Kontrollerar krav");
    CheckCommand("node.exe", "Node.js", "https://nodejs.org/");
    CheckCommand("npm.cmd", "npm", "Installera Node.js LTS från https://nodejs.org/");
    CheckCommand("git.exe", "Git", "https://git-scm.com/download/win");
    var chrome = new[]
    {
        @"C:\Program Files\Google\Chrome\Application\chrome.exe",
        @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    }.FirstOrDefault(File.Exists);
    if (chrome is null) throw new InvalidOperationException("Google Chrome hittades inte.");
    Console.WriteLine("  [OK] Google Chrome");

    Header("Steg 2 av 3 · Lokal adminpanel");
    Console.WriteLine("Adminpanelen körs lokalt på http://127.0.0.1:8787.");
    var adminPassword = ReadSecret("Välj adminlösenord (minst 12 tecken): ");
    if (adminPassword.Length < 12) throw new InvalidOperationException("Adminlösenordet måste ha minst 12 tecken.");

    Header("Steg 3 av 3 · Installerar");
    var environment = new Dictionary<string, string> { ["ADMIN_DASHBOARD_PASSWORD"] = adminPassword };
    var powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
    var arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{Path.Combine(project, "install.ps1")}\"";
    Console.WriteLine("Installerar beroenden och registrerar Windows-uppgifter...");
    var result = RunProcess(powershell, arguments, environment, false);
    if (result.ExitCode != 0) throw new InvalidOperationException(result.Output);

    Console.ForegroundColor = ConsoleColor.Green;
    Console.WriteLine("\nInstallation klar.");
    Console.ResetColor();
    Console.WriteLine("Öppna http://127.0.0.1:8787 för adminpanelen.");
    Console.WriteLine("Fyll i users.local.json och konfigurera tjänstevariabler enligt README.md.");
    Console.WriteLine();
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
