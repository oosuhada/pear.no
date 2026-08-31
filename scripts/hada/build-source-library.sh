#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DL="/Users/gabrieljang/Downloads"
OUT="$ROOT/hada/reference/source-library-v1"
MEDIA="$OUT/media"
THUMBS="$OUT/thumbs"
TMP="$OUT/.tmp"

mkdir -p "$MEDIA" "$THUMBS" "$TMP"

# Keep rebuilds deterministic when the numbered library changes.
rm -f "$MEDIA"/*.mp4 "$THUMBS"/*.jpg "$TMP"/* 2>/dev/null || true

encode_range() {
  local input="$1" start="$2" end="$3" output="$4"
  /opt/homebrew/bin/ffmpeg -hide_banner -loglevel error -y \
    -ss "$start" -to "$end" -i "$DL/$input" \
    -an -vf "scale='min(1920,iw)':-2,fps=30" \
    -c:v libx264 -preset fast -crf 19 -pix_fmt yuv420p \
    -force_key_frames "expr:gte(t,n_forced*0.5)" \
    -movflags +faststart "$MEDIA/$output"
}

encode_range_scrub_720() {
  local input="$1" start="$2" end="$3" output="$4"
  /opt/homebrew/bin/ffmpeg -hide_banner -loglevel error -y \
    -ss "$start" -to "$end" -i "$DL/$input" \
    -an -vf "scale=1280:-2,fps=30" \
    -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p \
    -force_key_frames "expr:gte(t,n_forced*0.25)" \
    -movflags +faststart "$MEDIA/$output"
}

encode_range_slow_2x() {
  local input="$1" start="$2" end="$3" output="$4"
  /opt/homebrew/bin/ffmpeg -hide_banner -loglevel error -y \
    -ss "$start" -to "$end" -i "$DL/$input" \
    -an -vf "setpts=2*PTS,scale='min(1920,iw)':-2,fps=30" \
    -c:v libx264 -preset fast -crf 19 -pix_fmt yuv420p \
    -force_key_frames "expr:gte(t,n_forced*0.5)" \
    -movflags +faststart "$MEDIA/$output"
}

# 01 is authored inside a 1920x1080 letterboxed frame. The actual image is
# 1920x816 with 132px black bars baked into both the top and bottom.
/opt/homebrew/bin/ffmpeg -hide_banner -loglevel error -y \
  -ss 17.3 -to 53.4 -i "$DL/nQJopt_M5mE.mp4" \
  -an -vf "crop=1920:816:0:132,fps=30" \
  -c:v libx264 -preset fast -crf 19 -pix_fmt yuv420p \
  -force_key_frames "expr:gte(t,n_forced*0.5)" \
  -movflags +faststart "$MEDIA/01_light-shadow.mp4"
encode_range "305660_medium.mp4" 0.5 11.8 "02_forest.mp4"
encode_range "apYbsj7qFTU.mp4" 39 89.2 "03_civic-light.mp4"
# Alpine is a long, visually dense source. A 720p proxy with denser keyframes
# keeps Safari scroll-scrubbing responsive without changing the curated cut.
encode_range_scrub_720 "318885_medium.mp4" 4 55 "04_alpine.mp4"
encode_range "268528_medium.mp4" 1.5 23.5 "05_blossom.mp4"
encode_range "mMD63t-W0Os.mp4" 26.8 59.7 "06_abstract-orbit.mp4"
encode_range_slow_2x "16639006_1920_1080_25fps.mp4" 2 20 "07_watch.mp4"
encode_range_slow_2x "12892259_3840_2160_60fps.mp4" 0.4 10.9 "08_reef.mp4"
encode_range "15549988_3840_2160_30fps.mp4" 0.4 11.2 "09_ice.mp4"

# 10 stays entirely before the original film's end-title / credit sequence.
encode_range "0mr4d_xkqnU.mp4" 72.5 118 "10_water-essay.mp4"

encode_range "262215_medium.mp4" 2 37 "11_coast.mp4"
encode_range "aiQdLP2mBJE.mp4" 5 55 "12_earth.mp4"

for video in "$MEDIA"/*.mp4; do
  base="$(basename "$video" .mp4)"
  duration="$(/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")"
  id="${base%%_*}"
  case "$((10#$id))" in
    6) thumb_time="0.100" ;;
    14) thumb_time="17.000" ;;
    *) thumb_time="$(awk -v d="$duration" -v id="$((10#$id))" 'BEGIN{t=2+((id*73)%201)/100;if(t>d-.1)t=d-.1;if(t<.1)t=.1;printf "%.3f",t}')" ;;
  esac
  /opt/homebrew/bin/ffmpeg -hide_banner -loglevel error -y -ss "$thumb_time" -i "$video" -frames:v 1 \
    -vf "scale=960:-2" -q:v 2 "$THUMBS/$base.jpg"
done

echo "Built source library at $OUT"
