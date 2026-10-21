import bpy, os, json, math, time
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from pathlib import Path
ROOT=str(Path(__file__).resolve().parents[1])
SRC=os.environ.get('KAMAKURA_V14_BLEND',str(Path(ROOT).parent/'review_scene_v14/deliverable/Kamakura_Review_Scene_v14.blend'))
ASSET=ROOT+'/dist/assets'
os.makedirs(ASSET,exist_ok=True);os.makedirs(ASSET+'/textures',exist_ok=True)
t0=time.time()
def log(*s): print('EXPORT',*s,flush=True)
bpy.ops.wm.open_mainfile(filepath=SRC)
scene=bpy.context.scene
GROUND=['Continuous earthen banks and deeply worn wet foot-cart path','Yard transition | one connected grade to existing path']
# Source actual ground surface retained for physics independently of visual LOD.
bvhs=[]
for name in GROUND:
 o=bpy.data.objects[name];o['walkthroughGround']=True
 vs=[o.matrix_world@v.co for v in o.data.vertices];ps=[list(p.vertices) for p in o.data.polygons]
 bvhs.append(BVHTree.FromPolygons(vs,ps));
ground={'minX':-15,'minZ':-11,'step':.2,'nx':70,'nz':91,'sourceObjects':GROUND,'heights':[]}
for iz in range(ground['nz']):
 for ix in range(ground['nx']):
  x=ground['minX']+ix*.2;z=ground['minZ']+iz*.2;hs=[]
  for b in bvhs:
   hit=b.ray_cast(Vector((max(-14.999999,min(9.999999,x)),max(-6.999999,min(10.999999,-z)),5)),Vector((0,0,-1)),10)[0]
   if hit:hs.append(hit.z)
  ground['heights'].append(round(max(hs),5) if hs else None)
def makebox(id,label,objs,zlimit=None):
 v=[]
 for o in objs:
  for vert in o.data.vertices:
   p=o.matrix_world@vert.co
   if zlimit is None or p.z<zlimit:v.append((p.x,p.z,-p.y))
 return {'id':id,'label':label,'minX':round(min(p[0] for p in v),4),'maxX':round(max(p[0] for p in v),4),'minY':round(min(p[1] for p in v),4),'maxY':round(max(p[1] for p in v),4),'minZ':round(min(p[2] for p in v),4),'maxZ':round(max(p[2] for p in v),4),'sourceObjects':[o.name for o in objs]}
boxes=[makebox('house','Farmhouse and raised porch',[bpy.data.objects['ARCH_Hero_Farmhouse_Thatch_Individual_floor_and_shutter_boards'],bpy.data.objects['ARCH_Hero_Farmhouse_Thatch_Clay_plaster_panels']],1.3),makebox('well','Timber well low structure',[bpy.data.objects['timber_well']],1.6)]
water=[makebox('channel','Irrigation channel',[bpy.data.objects['Main irrigation current | STATIC downhill 0.85 percent']]),makebox('paddy','Flooded paddy',[bpy.data.objects['Paddy shallows | STATIC']])]
collision={'coordinateSystem':'three-y-up','bounds':{'minX':-15,'maxX':-1.2,'minZ':-11,'maxZ':7},'sceneBounds':{'minX':-15,'maxX':10,'minZ':-11,'maxZ':7},'boxes':boxes,'waterHazards':water,'ground':ground,'notes':['Heightfield samples source v14 ground, not decimated visual mesh. Row-major index iz*nx+ix.','maxX=-1.2 is conservative dry-bank walking limit.','House uses boards and plaster at z<1.3m, excludes eaves; porch is intentionally inaccessible, no stairs.','Well box uses actual geometry below 1.6m, excludes roof.','Apply player-radius inset to bounds and collision boxes.']}
json.dump(collision,open(ASSET+'/collision.json','w'),separators=(',',':'))
log('COLLISION READY',boxes,'null samples',sum(h is None for h in ground['heights']))
if '--collision-only' in __import__('sys').argv:raise SystemExit
import numpy as np
report={'source':SRC,'sourceUnchanged':True,'textureCap':1024,'collision':'collision.json','simplifications':[],'meshChanges':[]}
# Export copies only; source blend is never saved.
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1
scene.render.bake.margin=8
bpy.ops.object.select_all(action='DESELECT')

def simple_nodes(mat,color=(.3,.25,.15,1),rough=.8):
 mat.use_nodes=True;ns=mat.node_tree.nodes;ns.clear();bs=ns.new('ShaderNodeBsdfPrincipled');out=ns.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(bs.outputs['BSDF'],out.inputs['Surface']);bs.inputs['Base Color'].default_value=color;bs.inputs['Roughness'].default_value=rough
 return bs

def bake_object_color(o,tag,planar=False):
 log('BAKE START',o.name)
 o.data=o.data.copy()
 oldmats=list(o.data.materials);o.data.materials.clear()
 for m in oldmats:o.data.materials.append(m.copy())
 bpy.ops.object.select_all(action='DESELECT');o.hide_set(False);o.hide_render=False;o.select_set(True);bpy.context.view_layer.objects.active=o
 olduv=o.data.uv_layers.active
 uv=o.data.uv_layers.new(name='WalkthroughBakedUV');o.data.uv_layers.active=uv
 if planar:
  lo=[min(v.co[k] for v in o.data.vertices) for k in range(2)];hi=[max(v.co[k] for v in o.data.vertices) for k in range(2)]
  for l in o.data.loops:
   p=o.data.vertices[l.vertex_index].co;uv.data[l.index].uv=((p.x-lo[0])/(hi[0]-lo[0]),(p.y-lo[1])/(hi[1]-lo[1]))
 else:
  bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.1519,island_margin=.012);bpy.ops.object.mode_set(mode='OBJECT')
 uv.active_render=True
 im=bpy.data.images.new('Walkthrough_'+tag+'_basecolor',width=1024,height=1024,alpha=False)
 for m in o.data.materials:
  ns=m.node_tree.nodes;links=m.node_tree.links
  bs=next(n for n in ns if n.type=='BSDF_PRINCIPLED');out=next(n for n in ns if n.type=='OUTPUT_MATERIAL')
  em=ns.new('ShaderNodeEmission')
  if bs.inputs['Base Color'].is_linked:links.new(bs.inputs['Base Color'].links[0].from_socket,em.inputs['Color'])
  else:em.inputs['Color'].default_value=bs.inputs['Base Color'].default_value
  links.new(em.outputs[0],out.inputs['Surface']);tex=ns.new('ShaderNodeTexImage');tex.image=im;ns.active=tex
 bpy.ops.object.bake(type='EMIT')
 im.filepath_raw=ASSET+'/textures/'+tag+'_basecolor.jpg';im.file_format='JPEG';im.save();im.pack()
 m=bpy.data.materials.new('Walkthrough baked '+tag);bs=simple_nodes(m,rough=.86);tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;uvnode=m.node_tree.nodes.new('ShaderNodeUVMap');uvnode.uv_map=uv.name;m.node_tree.links.new(uvnode.outputs[0],tex.inputs['Vector']);m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
 o.data.materials.clear();o.data.materials.append(m)
 for p in o.data.polygons:p.material_index=0
 # Baked base already contains original color attributes. Remove them to prevent multiplication twice.
 for a in list(o.data.color_attributes):o.data.color_attributes.remove(a)
 # Original UV is not needed: retaining a single named map prevents index ambiguity.
 for u in list(o.data.uv_layers):
  if u.name!=uv.name:o.data.uv_layers.remove(u)
 report['simplifications'].append(o.name+': original procedural/color-attribute base color baked into 1024² sRGB texture; original geometry retained then decimated.')
 log('BAKE DONE',o.name)
for i,n in enumerate(GROUND):bake_object_color(bpy.data.objects[n],'terrain_'+str(i),True)
bake_object_color(bpy.data.objects['ARCH_Hero_Farmhouse_Thatch_Clay_plaster_panels'],'clay_plaster',False)

# The source image maps and source UVs are retained; remove only shader graphs unsupported by glTF.
used_mats={m for o in scene.objects if o.type=='MESH' for m in o.data.materials if m}
for mat in used_mats:
 if mat.name.startswith('Walkthrough baked'):continue
 old_nodes=list(mat.node_tree.nodes) if mat.use_nodes else []
 oldbs=next((n for n in old_nodes if n.type=='BSDF_PRINCIPLED'),None)
 color=list(oldbs.inputs['Base Color'].default_value) if oldbs else list(mat.diffuse_color)
 rough=oldbs.inputs['Roughness'].default_value if oldbs else .8
 metallic=oldbs.inputs['Metallic'].default_value if oldbs else 0
 imgs=[n.image for n in old_nodes if n.type=='TEX_IMAGE' and n.image]
 ramps=[n.color_ramp for n in old_nodes if n.type=='VALTORGB']
 if oldbs and oldbs.inputs['Base Color'].is_linked and ramps:color=list(ramps[0].evaluate(.55))
 diffuse=next((im for im in imgs if any(k in im.name.lower() for k in ['basecolor','_diff','albedo','straw_tone','wood_grain','stone_grain'])),None)
 normal=next((im for im in imgs if '_nor' in im.name.lower()),None)
 # Preserve source rice-tip gradient exactly on the existing BladeUV map.
 if mat.name.startswith('Rice leaf'):
  ramp=next(n.color_ramp for n in old_nodes if n.type=='VALTORGB' and 'gradient' in n.name)
  diffuse=bpy.data.images.new('Walkthrough_'+mat.name.split('|')[0].strip().replace(' ','_'),width=16,height=256,alpha=False)
  px=np.zeros((256,16,4),np.float32)
  for y in range(256):px[y,:,:]=ramp.evaluate(y/255)
  # Ramp values are scene-linear. Generated sRGB pixels require explicit encoding.
  px[:,:,:3]=np.where(px[:,:,:3]<=0.0031308,12.92*px[:,:,:3],1.055*np.power(px[:,:,:3],1/2.4)-0.055)
  diffuse.pixels.foreach_set(px.ravel());diffuse.filepath_raw=ASSET+'/textures/'+diffuse.name+'.png';diffuse.file_format='PNG';diffuse.save();diffuse.pack()
 if mat.name.startswith('V07_Wood_board_') or mat.name.startswith('ARCH_') and diffuse and 'weathered_planks' in diffuse.name:
  tint=next((n.inputs['Color2'].default_value[:] for n in old_nodes if n.name=='Board exposure and tone'),(.8,.75,.65,1))
  color=[tint[k]*[.76,.72,.64,1][k] for k in range(4)]
 elif diffuse:color=[1,1,1,1]
 bs=simple_nodes(mat,color,rough=max(.35,float(rough)));bs.inputs['Metallic'].default_value=metallic
 ns=mat.node_tree.nodes;links=mat.node_tree.links
 if diffuse:
  t=ns.new('ShaderNodeTexImage');t.image=diffuse
  # Direct texture * constant is supported as glTF baseColorFactor.
  if color[:3]!=[1,1,1]:
   mix=ns.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=color;links.new(t.outputs['Color'],mix.inputs[1]);links.new(mix.outputs[0],bs.inputs['Base Color'])
  else:links.new(t.outputs['Color'],bs.inputs['Base Color'])
 if normal:
  nt=ns.new('ShaderNodeTexImage');nt.image=normal;nm=ns.new('ShaderNodeNormalMap');nm.inputs['Strength'].default_value=.65;links.new(nt.outputs['Color'],nm.inputs['Color']);links.new(nm.outputs[0],bs.inputs['Normal'])
 if mat.name=='grass_medium_01':
  alpha=next((im for im in imgs if 'alpha' in im.name),None)
  if alpha:
   at=ns.new('ShaderNodeTexImage');at.image=alpha;links.new(at.outputs['Color'],bs.inputs['Alpha']);mat.surface_render_method='DITHERED';mat.use_transparency_overlap=False
 if any(k in mat.name.lower() for k in ['channel water','flooded rice surface','muddy puddles']):
  bs.inputs['Base Color'].default_value=(.10,.145,.10,1);bs.inputs['Roughness'].default_value=.19;bs.inputs['Metallic'].default_value=.12
  mat['walkthroughWater']=True
 # Thin original blades and fibres need to remain visible from both sides.
 mat.use_backface_culling=False
report['simplifications'].append('Source image diffuse and normal maps retained on source UVs. Wood tint retained; unsupported noise overlays, layered bumps, anisotropy/translucency and displaced shader details omitted. Rice UV tip gradients rasterized at 16×256. Static water uses opaque green PBR to avoid expensive transmission.')

# Cap every USED image while keeping aspect ratio; unused packed source maps never export.
used_images={n.image for m in used_mats for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image}
for im in used_images:
 w,h=im.size
 if max(w,h)>1024:
  sc=1024/max(w,h);im.scale(round(w*sc),round(h*sc));im.pack()
log('MATERIALS READY',len(used_mats),'images',len(used_images))

# Flatten hierarchy without changing world transforms, convert the handful of curves.
objects=[]
for o in list(scene.objects):
 if o.type not in {'MESH','CURVE'} or o.hide_render:continue
 mw=o.matrix_world.copy();o.parent=None;o.matrix_world=mw;o.hide_set(False);objects.append(o)
for o in objects:
 if o.type=='CURVE':
  bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
# Keep shared data shared after one simplification per source mesh.
groups={}
for o in objects:groups.setdefault(o.data.as_pointer(),[]).append(o)

def tris(me):return sum(len(p.vertices)-2 for p in me.polygons)
def budget(o,tri):
 n=o.name.lower();mn=o.data.name.lower()
 if 'rice curved leaf clump' in mn:return 480
 if 'mushiro' in n or 'mino |' in n:return 15000
 if 'waraji' in n:return 6500
 if 'hemp rope' in n:return 7000
 if 'bank vegetation' in n:return 18000
 if 'continuous earthen banks' in n:return 24000
 if 'yard transition' in n:return 8000
 if 'irregular_embedded_straw' in n:return 15000
 if 'dense_broken_eave' in n:return 14000
 if 'short_matted_straw' in n:return 7000
 if 'surface-following split' in n:return 10000
 if 'continuous_thatched_mass' in n:return 16000
 if 'fieldstone_footings' in n or 'reused footing scan' in n:return 1800
 if 'main irrigation current' in n or 'paddy shallows' in n:return 3500
 if 'clay_plaster_panels' in n:return 9000
 return min(tri,3000)
source_tri=sum(tris(o.data) for o in objects)
for idx,group in enumerate(groups.values()):
 o=group[0];old=o.data;before=tris(old);target=budget(o,before)
 if before>target*1.1:
  tmp=bpy.data.objects.new('_LOD_work',old.copy());scene.collection.objects.link(tmp)
  bpy.ops.object.select_all(action='DESELECT');tmp.select_set(True);bpy.context.view_layer.objects.active=tmp
  mod=tmp.modifiers.new('Preserve form browser LOD','DECIMATE');mod.ratio=target/before;mod.use_collapse_triangulate=True
  bpy.ops.object.modifier_apply(modifier=mod.name)
  new=tmp.data;new.name=old.name+'_BrowserLOD'
  repaired=new.validate(verbose=False,clean_customdata=True)
  new.update()
  if repaired:report.setdefault('validatedMeshes',[]).append(old.name)
  for ob in group:ob.data=new
  bpy.data.objects.remove(tmp,do_unlink=True)
  after=tris(new);report['meshChanges'].append({'mesh':old.name,'instances':len(group),'trianglesBefore':before,'trianglesAfter':after,'target':target})
  log('LOD',old.name,before,'->',after,'x',len(group))
 # GPU instancing supports flat hierarchy with same mesh and same material list.
 if 'Rice curved leaf clump' in old.name:
  for ob in group:ob['walkthroughRice']=True

# A common identity root is required by Blender 4.3 glTF sibling instancing.
root=bpy.data.objects.new('Kamakura browser scene',None);scene.collection.objects.link(root)
for o in objects:
 mw=o.matrix_world.copy();o.parent=root;o.matrix_world=mw
# Mark authoring source and metadata, select all exported objects.
bpy.ops.object.select_all(action='DESELECT')
for o in objects:o.select_set(True)
root.select_set(True)
final_tri=sum(tris(o.data) for o in objects)
unique_tri=sum(tris(g[0].data) for g in groups.values())
report.update({'sourceDrawnTriangles':source_tri,'exportDrawnTriangles':final_tri,'uniqueMeshTriangles':unique_tri,'exportObjectCount':len(objects),'riceInstances':sum('Rice curved leaf clump' in o.data.name for o in objects),'terrainMeshNames':GROUND,'gpuInstancingRequested':True})
log('TRIANGLES',source_tri,'->',final_tri,'UNIQUE',unique_tri)
# Avoid default white-material fallback: assert every exported material has a Principled shader.
for m in used_mats:assert any(n.type=='BSDF_PRINCIPLED' for n in m.node_tree.nodes),m.name
bpy.ops.export_scene.gltf(filepath=ASSET+'/scene.glb',export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_animations=False,export_lights=False,export_cameras=False,export_apply=False,export_gpu_instances=True,export_image_format='JPEG',export_jpeg_quality=84,export_image_quality=84,export_texcoords=True,export_normals=True,export_tangents=False,export_materials='EXPORT',export_vertex_color='ACTIVE',export_active_vertex_color_when_no_material=True,export_all_vertex_colors=False,export_shared_accessors=True)
report['glbBytes']=os.path.getsize(ASSET+'/scene.glb');report['seconds']=round(time.time()-t0,2)
# Read actual glTF export result, because requested instancing may not cover every mesh.
import struct
with open(ASSET+'/scene.glb','rb') as f:
 f.read(12);ln,typ=struct.unpack('<II',f.read(8));g=json.loads(f.read(ln))
report['glTF']={'meshes':len(g.get('meshes',[])),'nodes':len(g.get('nodes',[])),'materials':len(g.get('materials',[])),'images':len(g.get('images',[])),'extensionsUsed':g.get('extensionsUsed',[]),'instancingNodes':sum('EXT_mesh_gpu_instancing' in n.get('extensions',{}) for n in g.get('nodes',[]))}
json.dump(report,open(ROOT+'/reports/export_report.json','w'),indent=2)
log('DONE',report['glbBytes'],report['glTF'])
