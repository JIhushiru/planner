using System.Media;

namespace Planner;

/// <summary>Synthesises short bell-like chimes in memory (no sound files needed) and plays them asynchronously.</summary>
static class Chime
{
    const int SampleRate = 44100;
    static SoundPlayer? _player;
    static MemoryStream? _stream;

    public static void Play(string kind, double volume)
    {
        if (string.IsNullOrEmpty(kind) || kind == "none") return;
        try
        {
            byte[] wav = Build(kind, Math.Clamp(volume, 0, 1));
            _player?.Stop();
            _player?.Dispose();
            _stream?.Dispose();
            _stream = new MemoryStream(wav);
            _player = new SoundPlayer(_stream);
            _player.Play();
        }
        catch (Exception ex)
        {
            Program.Log(ex);
        }
    }

    static byte[] Build(string kind, double volume)
    {
        double[] notes = kind switch
        {
            "focusEnd" => new[] { 1046.50, 783.99, 659.25 },            // C6 G5 E5: settle into a break
            "breakEnd" => new[] { 659.25, 783.99, 1046.50 },            // E5 G5 C6: back to work
            "step" => new[] { 880.00, 1174.66 },                        // A5 D6: next step of a study session
            "done" => new[] { 783.99, 987.77, 1174.66, 1567.98 },       // G5 B5 D6 G6: session complete
            "reminder" => new[] { 987.77, 1318.51 },                    // B5 E6
            _ => new[] { 1046.50, 783.99, 659.25 },
        };

        const double gap = 0.17;
        const double tail = 1.15;
        int length = (int)((gap * (notes.Length - 1) + tail) * SampleRate);
        var mix = new double[length];
        for (int k = 0; k < notes.Length; k++)
        {
            int start = (int)(k * gap * SampleRate);
            double f = notes[k];
            for (int i = start; i < length; i++)
            {
                double t = (i - start) / (double)SampleRate;
                double env = Math.Min(1.0, t / 0.005) * Math.Exp(-t / 0.42);
                double s = Math.Sin(2 * Math.PI * f * t)
                         + 0.28 * Math.Sin(2 * Math.PI * 2 * f * t) * Math.Exp(-t / 0.16)
                         + 0.08 * Math.Sin(2 * Math.PI * 3.01 * f * t) * Math.Exp(-t / 0.08);
                mix[i] += s * env;
            }
        }

        double peak = 1e-9;
        foreach (double v in mix) peak = Math.Max(peak, Math.Abs(v));
        double gain = 0.9 * Math.Pow(volume, 1.6) / peak;
        int fade = SampleRate / 40;
        for (int i = 0; i < fade; i++) mix[length - 1 - i] *= i / (double)fade;

        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        int dataBytes = length * 2;
        w.Write("RIFF"u8.ToArray());
        w.Write(36 + dataBytes);
        w.Write("WAVE"u8.ToArray());
        w.Write("fmt "u8.ToArray());
        w.Write(16);
        w.Write((short)1);              // PCM
        w.Write((short)1);              // mono
        w.Write(SampleRate);
        w.Write(SampleRate * 2);        // byte rate
        w.Write((short)2);              // block align
        w.Write((short)16);             // bits per sample
        w.Write("data"u8.ToArray());
        w.Write(dataBytes);
        foreach (double v in mix) w.Write((short)Math.Clamp(Math.Round(v * gain * short.MaxValue), short.MinValue, short.MaxValue));
        w.Flush();
        return ms.ToArray();
    }
}
