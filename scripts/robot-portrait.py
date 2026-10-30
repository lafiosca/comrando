# The robot portrait (cosmetic option "Robot Portrait"): a head-on robot boss, 48x64 (6x8 tiles), drawn here and
# exported as src/core/robotart.ts (tiles, layout, palettes). Run from app/: python3 scripts/robot-portrait.py src/core/robotart.ts
# NES limits: each 8x8 tile is black + 3 colors of one of the 4 palettes; at most 16 distinct tiles (the spare tile
# slots in Killt's portrait art window), the right half mirrors the left. The talking frame swaps the eye's tile.
import math, os, sys
BEVEL=False
W,H=48,64
RGB={'K':(0,0,0),'W':(255,255,255),'R':(215,10,104),'D':(120,0,60),'B':(60,171,255),'N':(0,64,200),'G':(82,82,82)}
PAL=[('body','RWG'),('turret','BNW'),('eye','RDW'),('label','RWN')]
def blank(): return [['K']*W for _ in range(H)]
def put(img,x,y,c):
    if 0<=x<W and 0<=y<H: img[y][x]=c; img[y][W-1-x]=c   # mirrored
def draw(talk):
    im=blank()
    for y in range(2,5):                                       # top sensor cap (blue, a dark line across), off the frame's top
        for x in range(18,24):
            if y==2 and x<20: continue
            put(im,x,y,'N' if y==3 else 'B')
    top,bot,left=5,39,9                                        # head box: rows 0-4
    for y in range(top,bot+1):
        for x in range(left,24):
            if (x,y) in ((left,top),(left,bot)): continue
            edge = x==left or y==top or y==bot
            c='R' if edge else 'W'
            if not edge and x<=left+2: c='R' if (x+y)%2 else 'W'  # dithered side panel, like the sprite
            if not edge and x==left+3: c='G'
            put(im,x,y,c)
    for x in range(16,24): put(im,x,top,'N')                   # the cap's base on the head's top edge
    cx,cy=23.5,23.5                                            # eye, rows 2-3 of the middle columns only
    for y in range(16,32):
        for x in range(16,24):
            r=math.hypot(x-cx,y-cy)
            if r<(4.5 if talk else 2.5): put(im,x,y,'W')
            elif r<(6.5 if talk else 5.5): put(im,x,y,'R')
            elif r<7.6: put(im,x,y,'D')
    left=1                                                     # body: flush under the head, wider, cropped at the bottom
    for y in range(40,64):
        for x in range(left,24):
            if (x,y)==(left,40): continue
            if x>=9: put(im,x,y,'W'); continue                 # (under the head: no edge)
            edge = x==left or y==40
            c='R' if edge and x<8 else 'W'
            if not edge and x<=left+2: c='R' if (x+y)%2 else 'W'
            if not edge and x==left+3: c='G'
            put(im,x,y,c)
    tx,ty=23.5,52.5                                            # turret: blue dome, the barrel facing us
    for y in range(41,64):
        for x in range(8,24):
            r=math.hypot(x-tx,y-ty)
            if r<3: put(im,x,y,'K')
            elif r<5.5: put(im,x,y,'N')
            elif r<6.5: put(im,x,y,'W')
            elif r<9.5: put(im,x,y,'B')
            elif r<10.5: put(im,x,y,'N')
    # --- shading (only in tiles that are unique, or identically in shared ones) ---
    def shade(x,y,c='G'):
        if im[y][x]=='W': put(im,x,y,c)
    for y in range(6,39):                                      # head: a dithered gray band inside the gray stripe (bevel: solid)
        if not BEVEL and y%2: shade(13,y)
    for y in range(41,64):                                     # body: the same band (same place in its tile)
        if not BEVEL and y%2: shade(5,y)
    for x in range(14,24):                                     # head: shadow under the cap's base, and above the bottom edge
        if x>=16 and x%2: shade(x,6,'N')
        elif x<16 and x%2: shade(x,6)
        if BEVEL or (x+1)%2: shade(x,38)
        shade(x,37) if x%2==0 and False else None
    for x in range(9,24):                                      # body: the head's shadow on it (dark blue: the turret's tiles)
        if x%2: shade(x,40,'N')
    for y in range(int(ty)+2,64):                              # turret: darker dither on the dome's lower half
        for x in range(8,24):
            if im[y][x]=='B' and (x+y)%2: put(im,x,y,'N')
    for y in range(56,64):                                     # body: checkered shading in the bottom corners (tile 12)
        for x in range(8,14):
            if (x-8)+(63-y)<6 and (x+y)%2: shade(x,y,'N')
    D1=["##.....#","#.#....#","#.#.##.#","##.....#"]   # "D-1", one tile, upper left of the body
    for dy,row in enumerate(D1):
        for dx,ch in enumerate(row):
            if ch=='#': im[42+dy][8+dx]='R'                    # (not mirrored)
    return im

frames=[draw(False),draw(True)]
NES={'R':0x15,'W':0x30,'G':0x00,'B':0x21,'N':0x11,'D':0x05}
SLOTS=[37,38,39,46,47]+list(range(53,64))
def cell(im,i): tx,ty=i%6,i//6; return [im[ty*8+y][tx*8+x] for y in range(8) for x in range(8)]
def flip(px,h,v):
    rows=[px[i*8:i*8+8] for i in range(8)]
    if h: rows=[r[::-1] for r in rows]
    if v: rows=rows[::-1]
    return [c for r in rows for c in r]
tiles=[]; pal=[]; tid=[None]*48; attr=[0xff]*48
def find(px):
    for k,t in enumerate(tiles):
        for h in (0,1):
            for v in (0,1):
                if flip(t,h,v)==px: return k,h,v
    return None
for i in range(48):
    px=cell(frames[0],i)
    if set(px)=={'K'}: continue
    f=find(px)
    if f is None:
        cols=set(px)-{'K'}
        p=next(n for n,(_,cs) in enumerate(PAL) if cols<=set(cs))
        tiles.append(px); pal.append(p); f=(len(tiles)-1,0,0)
    k,h,v=f; tid[i]=k; attr[i]=pal[k]|(0x40 if h else 0)|(0x80 if v else 0)
mouth=[]
for i in range(48):
    a,b=cell(frames[0],i),cell(frames[1],i)
    if a!=b and tid[i] is not None and not any(m[0]==tid[i] for m in mouth):
        k=tid[i]; h,v=attr[i]&0x40,attr[i]&0x80
        tiles.append(flip(b,h,v)); pal.append(pal[k]); mouth.append((k,len(tiles)-1))
assert len(tiles)<=len(SLOTS), len(tiles)
def chr2(px,p):
    cs='K'+PAL[p][1]; idx=[cs.index(c) for c in px]
    lo=[sum(((idx[y*8+x])&1)<<(7-x) for x in range(8)) for y in range(8)]
    hi=[sum(((idx[y*8+x])>>1)<<(7-x) for x in range(8)) for y in range(8)]
    return lo+hi
layout=[0xff if t is None else SLOTS[t] for t in tid]+attr+[b for k,a in mouth for b in (SLOTS[k],SLOTS[a])]+[0xff]
group=[b for _,cs in PAL for b in [0x0f]+[NES[c] for c in cs]]
hx=lambda bs: ', '.join('0x%02x'%b for b in bs)
out=open(sys.argv[1],'w')
out.write("""// Generated by scripts/robot-portrait.py (the robot portrait's art): edit the drawing there, not this file.

/** Tile slots of the art window (Killt's, 9:$8B80) the tiles go to: blanks his portrait never draws. */
export const ROBOT_SLOTS = [%s];
/** The tiles (16 bytes each, 2bpp), in ROBOT_SLOTS order. */
export const ROBOT_TILES = [
%s
];
/** The layout: 48 tile slots (6 x 8, $FF none), 48 attributes, the talking frame's swaps, $FF. */
export const ROBOT_LAYOUT = [%s];
/** The 4 sprite palettes (body, turret, eye, label); the enemy red $15 at +1, +9, +13. */
export const ROBOT_PALETTES = [%s];
""" % (hx(SLOTS[:len(tiles)]), '\n'.join('  [%s],'%hx(chr2(t,p)) for t,p in zip(tiles,pal)), hx(layout), hx(group)))
print('tiles',len(tiles),'layout',len(layout),'mouth',mouth)
