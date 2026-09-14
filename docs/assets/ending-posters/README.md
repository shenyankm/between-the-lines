# 结局海报素材基线

来源：[飞书文档](https://ccnoz23f7y98.feishu.cn/wiki/Ka47wg91jiUW1ekAcbFc9Fuonqe)，文档版本 1067，2026-09-15 重新下载核验。

按文档顺序为 E01 改写规则、E02 各自为界、E03 有限修复、E04 主动转身、E05 付出代价、E06 尚未破局。服务端按已保存事实判定结局，前端按 outcome.id 映射图片。

产品直接使用文档中的完整图片，保留标题、正文、手写文字和插画，不裁切、不覆盖、不拼接 AI 文案。按可用窗口等比例缩放。终幕开场仍按本局事实显示，之后展示对应原版卡片。

frontend/public/assets/ending-*.png 是下载原图，与本目录保留的 1064 版素材逐一核对哈希。provenance.json 记录原图和产品路径。WebP 为原图等比例压缩版本，使用 scripts/build-images.py 重建（需要 Pillow）。
