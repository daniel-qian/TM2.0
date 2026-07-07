import alchemistSheet from '../../../assets/Character/NPCs/Alchemist/alchemist_sprite_sheet.png'
import blacksmithSheet from '../../../assets/Character/NPCs/Blacksmith/blacksmith_sprite_sheet.png'
import demonSheet from '../../../assets/Character/Enemies/Demon/Demon_sprite_sheet.png'
import farmerSheet from '../../../assets/Character/NPCs/Farmer/farmer_sprite_sheet.png'
import kidSheet from '../../../assets/Character/NPCs/Kid/kid_sprite_sheet.png'
import merchantSheet from '../../../assets/Character/NPCs/Merchant/merchant_sprite_sheet.png'
import archerSheet from '../../../assets/Character/Players/Archer/archer_sprite_sheet.png'
import clericSheet from '../../../assets/Character/Players/Cleric/cleric_sprite_sheet.png'
import mageSheet from '../../../assets/Character/Players/Mage/mage_sprite_sheet.png'
import paladinSheet from '../../../assets/Character/Players/Paladin/paladin_sprite_sheet.png'
import swordsmanSheet from '../../../assets/Character/Players/Swordsman/swordsman_sprite_sheet.png'
import skeletonGeneralSheet from '../../../assets/Character/Enemies/Skeleton General/SkeletonGeneral_sprite_sheet.png'
import thiefSheet from '../../../assets/Character/Enemies/Thief/Thief_sprite_sheet.png'
import witchSheet from '../../../assets/Character/Enemies/Witch/Witch_sprite_sheet.png'

export interface AvatarSprite {
  src: string
  frameSize: number
  sheetWidth: number
  frameX: number
  frameY: number
}

function firstFrame(src: string): AvatarSprite {
  return {
    src,
    frameSize: 32,
    sheetWidth: 128,
    frameX: 0,
    frameY: 0,
  }
}

export const AVATAR_SPRITES = {
  alchemist: firstFrame(alchemistSheet),
  archer: firstFrame(archerSheet),
  blacksmith: firstFrame(blacksmithSheet),
  cleric: firstFrame(clericSheet),
  demon: firstFrame(demonSheet),
  farmer: firstFrame(farmerSheet),
  kid: firstFrame(kidSheet),
  mage: firstFrame(mageSheet),
  merchant: firstFrame(merchantSheet),
  paladin: firstFrame(paladinSheet),
  skeletonGeneral: firstFrame(skeletonGeneralSheet),
  swordsman: firstFrame(swordsmanSheet),
  thief: firstFrame(thiefSheet),
  witch: firstFrame(witchSheet),
} as const
