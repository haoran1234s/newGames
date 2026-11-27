/**
 * 启动引导：场景文件是手写的空场景，相机 / 画布 / 游戏节点全部在这里用代码创建。
 * 这样工程不依赖编辑器拖拽，命令行即可构建，场景结构也完全由代码版本管理。
 */
import {
  director, Director, Node, Canvas, Camera, UITransform, Layers,
  view, ResolutionPolicy, profiler,
} from 'cc';
import { DESIGN_W, DESIGN_H, PAL_COLOR } from './view/theme';
import { GameView } from './view/game-view';

/** 创建 2D 正交相机 + 画布，返回画布节点 */
function createCanvas(): Node {
  const canvasNode = new Node('Canvas');
  canvasNode.layer = Layers.Enum.UI_2D;
  canvasNode.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
  const canvas = canvasNode.addComponent(Canvas);

  const camNode = new Node('Camera');
  camNode.layer = Layers.Enum.UI_2D;
  camNode.setPosition(0, 0, 1000);
  const cam = camNode.addComponent(Camera);
  cam.projection = Camera.ProjectionType.ORTHO;
  cam.visibility = Layers.BitMask.UI_2D;
  cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
  cam.clearColor = PAL_COLOR.cream;
  cam.near = 0; cam.far = 2000;
  cam.priority = 0;
  canvasNode.addChild(camNode);
  canvas.cameraComponent = cam;
  return canvasNode;
}

director.once(Director.EVENT_AFTER_SCENE_LAUNCH, () => {
  // 与原型一致：375×667 完整显示，多余区域由页面底色（奶油色）填充
  view.setDesignResolutionSize(DESIGN_W, DESIGN_H, ResolutionPolicy.SHOW_ALL);
  // 调试包默认显示性能面板，会挡住画面；需要时在控制台执行 cc.profiler.showStats()
  profiler.hideStats();
  const scene = director.getScene();
  if (!scene) return;
  const canvasNode = createCanvas();
  scene.addChild(canvasNode);
  const root = new Node('Game');
  root.layer = Layers.Enum.UI_2D;
  root.addComponent(UITransform).setContentSize(DESIGN_W, DESIGN_H);
  canvasNode.addChild(root);
  root.addComponent(GameView);
});

