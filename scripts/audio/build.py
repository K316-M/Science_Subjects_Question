"""背景音乐：scripts/audio/src/<场景>/<档名>.* → assets/audio/<场景>/<档名>.mp3

  1. 剪掉头尾静音：原档结尾常有好几秒安静，网页循环播放时就会断一截
  2. 做成无缝循环：把结尾最後几秒和开头交叉淡接，放到尾巴；
     播完回到开头时，接上的正好是交叉淡接之後的那一段
  3. 音量统一到 -20 LUFS（所有页面一样大声，换页不会突然变响）
  4. 编成 96kbps mp3（背景音乐够用；原档更低就照原档）

原档放 scripts/（.vercelignore 排除，不会部署），网站只拿处理过的。
网页只认 ambient / background 这两个档名（js/scene-assets.js）。

用法：python3 scripts/audio/build.py            # 全部
      python3 scripts/audio/build.py physics    # 只做某个场景
"""
import glob
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
OUT = os.path.join(HERE, '..', '..', 'assets', 'audio')
LUFS = -20
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
    # 第二步：[body] 从 x 秒到结尾，[head] 开头 x 秒；acrossfade 把 body 的结尾和 head 叠在一起
    graph = (f'[0:a]atrim=start={x},asetpts=PTS-STARTPTS[body];'
             f'[1:a]atrim=end={x},asetpts=PTS-STARTPTS[head];'
             f'[body][head]acrossfade=d={x}:c1=qsin:c2=qsin[out]')
    run(['ffmpeg', '-hide_banner', '-y', '-i', tmp, '-i', tmp, '-filter_complex', graph, '-map', '[out]',
         '-c:a', 'libmp3lame', '-b:a', f'{kbps(src)}k', out])
    os.remove(tmp)
    before = os.path.getsize(src) // 1024
    after = os.path.getsize(out) // 1024
    print(f'{scene}/{name}: 剪掉头 {begin:.1f}s、尾 {duration(src) - finish:.1f}s，'
          f'循环淡接 {x:.1f}s，{duration(out):.0f}s，{before}KB → {after}KB')


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    files = sorted(glob.glob(os.path.join(SRC, '*', '*.*')))
    files = [f for f in files if not only or os.path.basename(os.path.dirname(f)) == only]
    if not files:
        print('scripts/audio/src/ 里没有档案')
    for f in files:
        build(f)


if __name__ == '__main__':
    main()
