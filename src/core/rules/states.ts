export const STATE_LABEL = {
  JOINING: "Đang vào công ty",
  IDLE: "Đang chờ",
  WALKING: "Đang di chuyển",
  WORKING: "Đang làm việc",
  BREAKING: "Đang nghỉ",
  MEETING: "Đang họp",
  SNEAKING: "Đang lén trốn",
  ESCAPING: "Đang bị đuổi",
  CAUGHT: "Đã bị bắt",
  ESCAPED: "Đã trốn thoát",
  AFK: "Tạm vắng",
  OFFLINE: "Đã rời phiên",
} as const;

export type AvatarState = keyof typeof STATE_LABEL;
