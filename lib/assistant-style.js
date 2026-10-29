const REPLY={
  concise:'说话风格：简短。先说重点，省去重复铺垫；必要的事实、步骤和风险仍要说清。',
  natural:'说话风格：自然。用日常、顺畅的表达交流，保持现有角色的身份和称呼。',
  formal:'说话风格：正式。用清楚、稳妥、礼貌的措辞，按需要组织信息。',
};
const EMOJI={none:'表情符号：不使用 emoji 表情符号。',moderate:'表情符号：可在合适时少量使用 emoji，避免连续堆叠。'};

// A presentation preference supplements the saved role; it grants no tools or authority.
export function assistantStyleText(profile={}){
  const choices=[REPLY[profile.replyStyle],EMOJI[profile.emojiStyle]].filter(Boolean);
  return choices.length?choices.join('\n')+'\n以上仅调整表达方式，不改变角色身份、事实判断或任何工具权限。':'';
}
