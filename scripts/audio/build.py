"""背景音乐：source/audio/<场景>/<档名>.* → assets/audio/<场景>/<档名>.mp3

  1. 剪掉头尾静音：原档结尾常有好几秒安静，网页循环播放时就会断一截
  2. 做成无缝循环：把结尾最後几秒和开头交叉淡接，放到尾巴；
     播完回到开头时，接上的正好是交叉淡接之後的那一段
  3. 音量统一到 -20 LUFS（BS.1770 的 K 加权，量「整体有多响」）
  4. 再按人耳的等响曲线（ISO 226:2003，40 phon）补一次：背景音乐开得小，人耳对低频的灵敏度掉得很多，
     K 加权只削 38 Hz 以下，低音多的曲子（生物那首 72% 的能量在 200 Hz 以下）「数字一样、听起来小」。
     所以把每首先过等响曲线、量出响度，再补到同一个 EQ_LUFS（有削波保护）
  5. 编成 96kbps mp3（背景音乐够用；原档更低就照原档）

原档放 source/audio/（.vercelignore 排除，不会部署），网站只拿处理过的。
source/audio/candidates/ 是还没决定要不要用的候选曲，这支脚本不会处理。
网页只认 ambient / background 这两个档名（js/scene-assets.js）。

用法：python3 scripts/audio/build.py            # 全部
      python3 scripts/audio/build.py physics    # 只做某个场景
"""
import glob
import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', 'source', 'audio')
OUT = os.path.join(HERE, '..', '..', 'assets', 'audio')
LUFS = -20
EQ_PHON = 40         # 等响曲线取几 phon：背景音乐开得小，约 40 phon
EQ_LUFS = -26.9      # 过了等响曲线之後的响度目标：用这支脚本量五首原档（都先调到 -20 LUFS），取中位数定的。换了 EQ_PHON 要重新量
LIMIT = 0.89         # 补音量後的削波保护，约 -1 dBFS
XFADE = 3.0          # 交叉淡接秒数；曲子太短时会自动缩短
SILENCE_DB = -50     # 低于这个音量算静音


def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=True)


def duration(path):
    out = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).stdout
    return float(out.strip())


def kbps(path):
    """96kbps，但原档本来更低就照原档（重编成更高码率只会变大、不会变好听）"""
    rate = run(['ffprobe', '-v', 'error', '-show_entries', 'format=bit_rate', '-of', 'csv=p=0', path]).stdout.strip()
    return min(96, int(rate) // 1000) if rate.isdigit() else 96


def trim_points(path):
    """回传 (开始, 结束)：头尾的静音剪掉"""
    total = duration(path)
    log = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path,
               '-af', f'silencedetect=n={SILENCE_DB}dB:d=0.2', '-f', 'null', '-']).stderr
    starts = [float(x) for x in re.findall(r'silence_start: ([\d.]+)', log)]
    ends = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', log)]
    begin, finish = 0.0, total
    if starts and starts[0] < 0.05 and ends:
        begin = ends[0]
    if starts and (len(ends) < len(starts) or ends[-1] >= total - 0.05):
        finish = starts[-1]
    return begin, finish


def loudnorm_args(path, begin, finish):
    """两段式 loudnorm：先量一次，再用量到的数值精准调整"""
    probe = run(['ffmpeg', '-hide_banner', '-nostats', '-ss', f'{begin}', '-to', f'{finish}', '-i', path,
                 '-af', f'loudnorm=I={LUFS}:TP=-2:LRA=11:print_format=json', '-f', 'null', '-']).stderr
    m = json.loads(probe[probe.rindex('{'):probe.rindex('}') + 1])
    return (f"loudnorm=I={LUFS}:TP=-2:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
            f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")


# ISO 226:2003 等响曲线（表 1：频率、α_f、L_U、T_f），公式见标准；40 phon 在 1 kHz 必须得 40 dB 才算算对
_ISO_F = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
          2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500]
_ISO_A = [.532, .506, .480, .455, .432, .409, .387, .367, .349, .330, .315, .301, .288, .276, .267, .259, .253, .250,
          .246, .244, .243, .243, .243, .242, .242, .245, .254, .271, .301]
_ISO_U = [-31.6, -27.2, -23.0, -19.1, -15.9, -13.0, -10.3, -8.1, -6.2, -4.5, -3.1, -2.0, -1.1, -0.4, 0.0, 0.3, 0.5, 0.0,
          -2.7, -4.1, -1.0, 1.7, 2.5, 1.2, -2.1, -7.1, -11.2, -10.7, -3.1]
_ISO_T = [78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6, 6.2, 4.4, 3.0, 2.2, 2.4,
          3.5, 1.7, -1.3, -4.2, -6.0, -5.4, -1.5, 6.0, 12.6, 13.9, 12.3]


def iso226_spl(i, phon):
    """第 i 个频率上，听起来和 1 kHz 的 phon 一样响，需要多少 dB SPL"""
    a = 4.47e-3 * (10 ** (0.025 * phon) - 1.15) + (0.4 * 10 ** ((_ISO_T[i] + _ISO_U[i]) / 10 - 9)) ** _ISO_A[i]
    return (10 / _ISO_A[i]) * math.log10(a) - _ISO_U[i] + 94


def ear_filter():
    """ffmpeg 滤镜：把声音按人耳在 EQ_PHON 的灵敏度加权（1 kHz 不变，低频削得多）。只用来量响度，不改输出的声音"""
    ref = iso226_spl(_ISO_F.index(1000), EQ_PHON)
    entries = ';'.join(f'entry({f},{max(-60.0, -(iso226_spl(i, EQ_PHON) - ref)):.2f})' for i, f in enumerate(_ISO_F))
    return f"firequalizer=gain_entry='{entries}':zero_phase=on"


def ear_loudness(path):
    """过了等响曲线之後的积分响度（LUFS 单位，只能和同一把尺量出来的比）"""
    log = run(['ffmpeg', '-hide_banner', '-nostats', '-i', path,
               '-af', f'{ear_filter()},ebur128=framelog=quiet', '-f', 'null', '-']).stderr
    m = re.findall(r'I:\s+(-?[\d.]+) LUFS', log)
    return float(m[-1])


def build(src):
    scene = os.path.basename(os.path.dirname(src))
    name = os.path.splitext(os.path.basename(src))[0]
    out = os.path.join(OUT, scene, name + '.mp3')
    os.makedirs(os.path.dirname(out), exist_ok=True)

    begin, finish = trim_points(src)
    length = finish - begin
    x = min(XFADE, length / 10)
    norm = loudnorm_args(src, begin, finish)
    # 第一步：剪静音、调音量，存成暂存 wav（同一张滤镜图里分流再合流，ffmpeg 会卡住）
    tmp = out + '.tmp.wav'
    run(['ffmpeg', '-hide_banner', '-y', '-ss', f'{begin}', '-to', f'{finish}', '-i', src,
         '-af', f'{norm},aresample=44100', '-ac', '2', tmp])
    # 过一遍等响曲线量响度，补到同一个 EQ_LUFS（低音多的曲子补得多）；补多了会削波的话由限幅器兜住
    heard = ear_loudness(tmp)
    gain = EQ_LUFS - heard
    lift = f'volume={gain:.2f}dB,alimiter=limit={LIMIT}:level=false'
    # 第二步：[body] 从 x 秒到结尾，[head] 开头 x 秒；acrossfade 把 body 的结尾和 head 叠在一起
    graph = (f'[0:a]{lift},atrim=start={x},asetpts=PTS-STARTPTS[body];'
             f'[1:a]{lift},atrim=end={x},asetpts=PTS-STARTPTS[head];'
             f'[body][head]acrossfade=d={x}:c1=qsin:c2=qsin[out]')
    run(['ffmpeg', '-hide_banner', '-y', '-i', tmp, '-i', tmp, '-filter_complex', graph, '-map', '[out]',
         '-c:a', 'libmp3lame', '-b:a', f'{kbps(src)}k', out])
    os.remove(tmp)
    before = os.path.getsize(src) // 1024
    after = os.path.getsize(out) // 1024
    print(f'{scene}/{name}: 剪掉头 {begin:.1f}s、尾 {duration(src) - finish:.1f}s，'
          f'循环淡接 {x:.1f}s，等响 {heard:.1f}→{EQ_LUFS} LUFS（{gain:+.1f} dB），{duration(out):.0f}s，{before}KB → {after}KB')


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    files = sorted(glob.glob(os.path.join(SRC, '*', '*.*')))
    files = [f for f in files if os.path.basename(os.path.dirname(f)) != 'candidates']
    files = [f for f in files if not only or os.path.basename(os.path.dirname(f)) == only]
    if not files:
        print('source/audio/ 里没有档案')
    for f in files:
        build(f)


if __name__ == '__main__':
    main()
