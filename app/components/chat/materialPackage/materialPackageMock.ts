import type { MaterialPackageRecord } from "@/components/materialPackage/materialPackageApi";
import { readMockPackages } from "@/components/chat/materialPackage/materialPackageMockStore";

export function getMockMaterialPackageSquare(): MaterialPackageRecord[] {
  return readMockPackages().filter(p => p.visibility === 1);
}

export function getMockMyMaterialPackages(): MaterialPackageRecord[] {
  const now = new Date().toISOString();
  return [
    {
      packageId: 1,
      userId: 0,
      name: "素材箱·示例",
      description: "接口未就绪时的本地示例数据（仅 dev/test 生效）",
      coverUrl: null,
      visibility: 1,
      status: 0,
      importCount: 0,
      createTime: now,
      updateTime: now,
      content: {
        version: 1,
        root: [
          {
            type: "folder",
            name: "场景",
            children: [
              {
                type: "material",
                name: "温馨小屋",
                note: "开场背景",
                messages: [
                  {
                    messageType: 2,
                    annotations: ["背景"],
                    extra: {
                      imageMessage: {
                        url: "",
                        fileName: "house.webp",
                        width: 1920,
                        height: 1080,
                        background: true,
                      },
                    },
                  },
                ],
              },
            ],
          },
          {
            type: "folder",
            name: "音乐",
            children: [
              {
                type: "material",
                name: "阴森BGM",
                note: "",
                messages: [
                  {
                    messageType: 3,
                    annotations: ["BGM"],
                    extra: {
                      soundMessage: {
                        url: "",
                        fileName: "bgm.mp3",
                      },
                    },
                  },
                ],
              },
            ],
          },
          {
            type: "folder",
            name: "文本",
            children: [
              {
                type: "material",
                name: "旁白模板",
                note: "",
                messages: [
                  {
                    messageType: 1,
                    content: "这是一段示例旁白。",
                    annotations: ["旁白"],
                    extra: {},
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  ];
}
