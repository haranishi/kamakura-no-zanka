#!/usr/bin/env python3
"""W2c-11 grass: compare row transitions in matching fixed-camera PNG crops.
Usage: python3 tools/grass-row-metrics.py before.png after.png --crop 30,260,1250,400
Pillow is needed only to read PNGs; --self-test uses the standard library.
"""
import argparse
import json


def row_metrics(rows, radius=5):
    """Maximum difference of adjacent averaged strips, avoiding single-pixel tips."""
    if len(rows) < 2 * radius:
        raise ValueError('crop needs at least ten rows')
    brightness = [sum(.2126*r + .7152*g + .0722*b for r, g, b in row)/len(row) for row in rows]
    green = [sum(g-(r+b)/2 for r, g, b in row)/len(row) for row in rows]

    def step(values):
        return max(abs(sum(values[i:i+radius])-sum(values[i-radius:i]))/radius
                   for i in range(radius, len(values)-radius+1))

    return {'brightness_step': step(brightness), 'green_step': step(green),
            'brightness_mean': sum(brightness)/len(rows), 'rows': len(rows)}


def read_crop(filename, crop):
    from PIL import Image
    with Image.open(filename) as source:
        if not (0 <= crop[0] < crop[2] <= source.width and 0 <= crop[1] < crop[3] <= source.height):
            raise ValueError('crop outside image')
        rgb = source.convert('RGB').crop(crop)
        # Decode display sRGB; screenshots still contain the renderer's tone mapping.
        def linear(v):
            c = v / 255
            return c / 12.92 if c <= .04045 else ((c+.055)/1.055)**2.4
        pixels = [tuple(linear(v) for v in p) for p in (rgb.get_flattened_data() if hasattr(rgb, 'get_flattened_data') else rgb.getdata())]
        return [pixels[y*rgb.width:(y+1)*rgb.width] for y in range(rgb.height)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', nargs='?')
    parser.add_argument('after', nargs='?')
    parser.add_argument('--crop', default='30,260,1250,400')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        flat = [[(.2, .3, .1)]*4 for _ in range(40)]
        hard = [[(.2, .3 if y < 20 else .5, .1)]*4 for y in range(40)]
        ramp = [[(.2, .3 + .2*y/39, .1)]*4 for y in range(40)]
        assert row_metrics(flat)['brightness_step'] == 0
        for key in ['brightness_step', 'green_step']:
            assert row_metrics(ramp)[key] < row_metrics(hard)[key]*.7
        print('row metrics self-test passed')
        return
    if not args.before or not args.after:
        parser.error('before and after PNGs required')
    crop = tuple(map(int, args.crop.split(',')))
    before, after = [row_metrics(read_crop(name, crop)) for name in [args.before, args.after]]
    ratios = {k: after[k]/before[k] if before[k] else None for k in ['brightness_step', 'green_step']}
    print(json.dumps({'before': before, 'after': after, 'ratios': ratios,
                      'target': 'both step ratios <= 0.70; matching crop and camera required'}, indent=2))


if __name__ == '__main__':
    main()
