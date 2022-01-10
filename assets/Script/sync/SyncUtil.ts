/**
 * 网络同步基础工具
 * 1. 属性复制相关
 *  基础属性复制（number、string
 *  对象复制（简单对象
 *  容器复制（支持嵌套容器与对象
 *      数组复制
 *      Set复制
 *      Hash复制
 * 2. 属性装饰器与类装饰器
 * 3. Diff的生成与Apply
 */

/** 属性变化回调 */
export type ReplicateNotify = (target: any, key: string, value: any) => boolean;
export type Consturctor = { new(...args: any[]): any };

export const REPLICATE_OBJECT_INDEX = "__repObj__";
export const REPLICATE_MARK_INDEX = "__repMrk__";

/** 是否支持装饰器的Setter设置 */
const IsSupportGetSet = false;

/**
 * 属性同步选项
 */
export interface ReplicatedOption {
    /** 要同步的属性名 */
    Name: string;
    /** 应用同步的方法，默认为Name */
    Setter?: string;
    /** 属性同步条件 */
    Condiction?: number;
    /** 同步回调 */
    Notify?: ReplicateNotify;
}

/**
 * 对象属性同步配置
 */
export interface ObjectReplicatedOption {
    /** 指定同步哪些属性 */
    SyncProperty?: ReplicatedOption[];
    /** 指定跳过哪些属性的同步 */
    SkipProperty?: string[];
}

interface ReplicateMarkInfo {
    /** 默认值 */
    def?: any,
    option?: ReplicatedOption,
}

/**
 * 查询对象的ReplicateObject，检查对象的target.__repObj__字段
 * 每个实例会有一个自己的ReplicateObject
 * @param target 要查询的对象
 * @param autoCreator 找不到是否自动创建一个？
 * @returns 返回找到的ReplicateObject
 */
export function getReplicateObject(target: any, autoCreator: boolean = false): ReplicateObject {
    let ret: ReplicateObject = target[REPLICATE_OBJECT_INDEX];
    if (!ret && autoCreator) {
        ret = new ReplicateObject();
        Object.defineProperty(target, REPLICATE_OBJECT_INDEX, {
            value: ret,
            enumerable: false,
            writable: false,
            configurable: true,
        });
    }
    return ret;
}

/**
 * 获取该类的标记对象（所有实例共享
 * @param target 要修饰的类对象
 * @returns ReplicateMark
 */
export function getReplicateMark(target: any): ReplicateMark {
    let ret: ReplicateMark = target[REPLICATE_MARK_INDEX];
    if (!ret) {
        ret = new ReplicateMark(target);
        Object.defineProperty(target, REPLICATE_MARK_INDEX, {
            value: ret,
            enumerable: false,
            writable: false,
            configurable: true,
        });
    }
    return ret;
}

/**
 * 构造一个属性复制的Descriptor，设置该Descriptor的get/set
 * 在不影响原来set方法的基础上自动跟踪属性变化
 * @param target 要跟踪的实例
 * @param propertyKey 要跟踪的Key
 * @param descriptor ReplicatedOption
 * @param option 
 * @returns 返回修改好的ReplicatedOption
 */
function makePropertyDescriptor(propertyKey: string, descriptor: PropertyDescriptor, option?: ReplicatedOption): PropertyDescriptor {
    // 在不影响原来set方法的基础上自动跟踪属性变化
    let realProperty: string;
    if (option && option.Setter) {
        realProperty = option.Setter;
    } else {
        realProperty = propertyKey;
    }
    delete descriptor.value;
    delete descriptor.writable;
    let oldSet = descriptor.set;
    descriptor.set = function (v: any) {
        let repObj = getReplicateObject(this, true);
        // 标记属性发生变化
        repObj.propertyChanged(realProperty, v);
        if (oldSet) {
            oldSet(v);
        }
    }
    // 在不影响原来get方法的基础上，实现set方法的对应操作
    let oldGet = descriptor.get;
    if (!oldGet) {
        descriptor.get = function() {
            let repObj = getReplicateObject(this, true);
            return repObj.getProperty(realProperty);
        }
    }
    return descriptor;
}

/**
 * 将一个对象的指定属性设置为可复制，为对象自动添加__repObj__属性，同时跟踪该属性的变化
 * @param target 要指定的对象
 * @param propertyKey 对象的属性名
 * @param descriptor 属性的描述符
 * @param option 自定义同步选项
 */
function makePropertyReplicated(target: any, propertyKey: string, descriptor?: PropertyDescriptor, option?: ReplicatedOption) {
    if (!descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
    }
    if (descriptor) {
        // 在不影响原来set方法的基础上自动跟踪属性变化
        let oldValue = descriptor.value;
        // 使用initializer跟踪原始值
        if (oldValue === undefined 
            && Object.getOwnPropertyDescriptor(descriptor, "initializer")) {
            let desc: any = descriptor;
            oldValue = desc.initializer();
        }
        if (IsSupportGetSet) {
            descriptor = makePropertyDescriptor(propertyKey, descriptor, option);
            Object.defineProperty(target, propertyKey, descriptor);
            // 设置默认值
            if (oldValue !== undefined) {
                target[propertyKey] = oldValue;
            }
        } else {
            getReplicateMark(target).addMark(propertyKey, oldValue, option);
        }
    }
}

/**
 * 将一个对象的所有成员设置为可复制，为对象自动添加__repObj__属性，同时跟踪该属性的变化
 * @param target 
 * @param option 
 */
export function makeObjectReplicated(target: any, option?: ObjectReplicatedOption) {
    if (option && option.SyncProperty) {
        option.SyncProperty.forEach((pOpt) => {
            let descriptor = Object.getOwnPropertyDescriptor(target, pOpt.Name);
            if (descriptor) {
                makePropertyReplicated(target, pOpt.Name, descriptor, pOpt);
            }
        });
    } else {
        let keys = Object.keys(target);
        keys.forEach((key) => {
            if (!(option?.SkipProperty && option.SkipProperty.indexOf(key) >= 0)) {
                makePropertyReplicated(target, key, Object.getOwnPropertyDescriptor(target, key));
            }
        })
    }
}

/**
 * 属性同步装饰器，只能用于修饰属性，不能用于修饰方法
 * @param option 同步选项
 */
export function replicated(option?: ReplicatedOption) {
    // 真正的装饰器
    return (target: any, propertyKey: string, descriptor?: PropertyDescriptor) => {
        makePropertyReplicated(target, propertyKey, descriptor, option);
    };
}

export function replicatedClass<T extends Consturctor>(option?: ObjectReplicatedOption) {
    return (target: T) => {
        if (IsSupportGetSet) {
            makeObjectReplicated(target, option);
        } else {
            // 这里无法获取成员属性的descriptor，对属性的定义也会被后续的实例化覆盖
            if (option) {
                getReplicateMark(target.prototype).setObjMark(option);
            } else {
                getReplicateMark(target.prototype).setDefaultMark(true);
            }
        }
    }
}

class ReplicateMark {
    public init = false;
    private markMap: Map<string, ReplicateMarkInfo> = new Map<string, ReplicateMarkInfo>();
    private objMark?: ObjectReplicatedOption;
    private defaultMark = false;
    private cls: any;

    public constructor(cls: any) {
        this.cls = cls;
    }

    public getCls(): any { return this.cls; }

    public setDefaultMark(def: boolean) {
        this.defaultMark = def;
    }

    public getDefaultMark() {
        return this.defaultMark;
    }

    public addMark(key: string, def?: any, option?: ReplicatedOption) {
        this.markMap.set(key, { def, option });
    }

    public getMark(key: string): ReplicateMarkInfo | undefined {
        return this.markMap.get(key);
    }

    public getMarks(): Map<string, ReplicateMarkInfo> {
        return this.markMap;
    }

    public setObjMark(objMark: ObjectReplicatedOption) {
        this.objMark = objMark;
    }

    public getObjMark(): ObjectReplicatedOption | undefined {
        return this.objMark;
    }
}

/**
 * 一个属性的变化信息
 * changed : 是否有发生过变化
 * version : 该属性的最新版本号
 * data : 该属性的最新数据
 * 
 * 当属性为 :
 * 基础类型 - data为最新的值
 * 结构对象类型 - data为ReplicateObject
 * 数组类型 - data为整个数组对象（每次变化都会全量更新数组）
 * 节点类型 - data为节点的网络唯一ID
 * 组件类型 - data为组件的网络唯一ID
 */
interface ReplicateProperty {
    changed: boolean;
    version: number;
    data: any;
}

/**
 * 负责一个类中所有被标记为replicate的属性的复制和赋值
 * 收集所有增量的变化，并标记版本号
 */
class ReplicateObject {
    private static IsServer: boolean = false;
    /** 最后一个有数据变化的版本号 */
    private lastVersion: number = 0;
    /** 所有发生过变化的数据，属性名 : 变化参数 */
    private dataMap: Map<string, ReplicateProperty> = new Map<string, ReplicateProperty>();
    /** 自上次同步后有无属性发生过变化 */
    private hasNewChange: boolean = false;
    /** outter的ReplicateObject */
    private outter: ReplicateObject | null = null;
    /** 在outter中的属性名 */
    private outterKey: string = "";

    public genProperty(outObject: any, key: string, data: any) {
        outObject[key] = data;
    }

    public getLastVersion(): number {
        return this.lastVersion;
    }

    /**
     * 当一个属性被重新赋值时回调，即 target.key = v时
     * 1. 对比数值是否有发生变化，有则更新dataMap
     * 2. 如果要赋值的是一个可复制对象 v intanceof Rep，设置当前target为v的outter
     * 3. 当属性变化时存在outer
     * 
     * PS: 初始化赋值是否可以跳过？是否可以存着多个outer？
     * @param key 
     * @param v 
     * @param force 
     */
    public propertyChanged(key: string, v?: any, force?: boolean): void {
        let repPro = this.dataMap.get(key);
        let changed = force != true;

        if (repPro) {
            if (v === repPro.data) {
                // 实际的数值并没有发生改变
                return;
            }
            repPro.changed = changed;
            if (!(v === undefined && repPro.data instanceof ReplicateObject)) {
                repPro.data = v;
            }
        } else {
            repPro = { version: 0, data: v, changed };
            this.dataMap.set(key, repPro);
        }

        // 如果设置了新的对象成员
        if (repPro.data instanceof ReplicateObject) {
            repPro.data.setOutter(this, key);
        }

        // 如果有outter，需要通知，但只通知一次就够了
        // 首次赋值时（初始值，无需通知outter）
        if (!this.hasNewChange && repPro.changed) {
            if (this.outter) {
                this.outter.propertyChanged(this.outterKey);
            }
            this.hasNewChange = true;
        }
    }

    public getProperty(key: string): any {
        let repPro = this.dataMap.get(key);
        return repPro ? repPro.data : repPro;
    }

    public setOutter(outter: ReplicateObject, key: string) {
        this.outter = outter;
        this.outterKey = key;
    }

    /**
     * 生成从fromVersion到toVersion的增量差异包，如果新的变化产生，则最新的变化会标记为toVersion
     * @param fromVersion 
     * @param toVersion 必须是最新的版本号
     */
    public genDiff(fromVersion: number, toVersion: number): any {
        if (toVersion < fromVersion) {
            return false;
        }

        // 没有差异
        if (fromVersion > this.lastVersion && !this.hasNewChange) {
            return false;
        }

        let outObject = {};
        for (let [key, property] of this.dataMap) {
            if (property.changed) {
                property.changed = false;
                property.version = toVersion;
            } else if (property.version < fromVersion) {
                continue;
            }
            if (property.data instanceof ReplicateObject) {
                let diff = property.data.genDiff(fromVersion, toVersion);
                if (diff != false) {
                    this.genProperty(outObject, key, diff);
                }
            } else {
                this.genProperty(outObject, key, property.data);
            }
        }
        this.lastVersion = toVersion;
        return outObject;
    }

    /**
     * 应用差异数据，更新到最新状态
     * @param diff 
     */
    public applyDiff(diff: any) {
        applyDiff(diff, this.outter);
    }
}

/**
 * 应用DIFF到target中
 * @param diff 
 * @param target 
 */
export function applyDiff(diff: any, target: any) {
    let keys = Object.keys(diff);
    keys.forEach((propertyName) => {
        if (typeof target[propertyName] == "function") {
            target[propertyName](diff[propertyName]);
        } else if (diff[propertyName] instanceof Object) {
            if (target[propertyName] instanceof Object) {
                let prop = target[propertyName];
                applyDiff(diff[propertyName], prop);
                target[propertyName] = prop;
            } else {
                console.warn(`apply diff error: ${propertyName}, 
                target.propertyName is ${target[propertyName]} diff ${diff[propertyName]}`);
            }
        } else {
            target[propertyName] = diff[propertyName];
        }
    });
}

/**
 * 提取变化目标对象指定版本范围的的DIFF
 * 如果是首次生成DIFF，自动检测哪些属性需要被追踪
 * @param target 
 * @param from 
 * @param to 
 * @returns DIFF对象
 */
export function genDiff(target: any, from: number, to: number): any {
    let repObj = getReplicateObject(target, true);
    if (!IsSupportGetSet && repObj.getLastVersion() == 0) {
        let markObj = getReplicateMark(target);

        // 延迟执行类的装饰
        let cls = markObj.getCls();
        let objMark = markObj.getObjMark();
        let isDef = markObj.getDefaultMark();
        if (!markObj.init && (isDef || objMark)) {
            makeObjectReplicated(cls, objMark);
        }

        let marks = markObj.getMarks();
        marks.forEach((info, propertyName) => {
            let descriptor = Object.getOwnPropertyDescriptor(cls, propertyName);
            if (descriptor) {
                let oldValue = descriptor.value;
                let oldSet = descriptor.set;

                // 延迟执行属性的装饰，只初始化一次
                if(!markObj.init) {
                    descriptor = makePropertyDescriptor(propertyName, descriptor, info.option);
                    Object.defineProperty(cls, propertyName, descriptor);    
                }
                
                // 每个实例都需要对所有同步属性进行一次遍历
                if (oldValue != info.def) {
                    // 如果值发生了变化，触发一次赋值，以便于生成DIFF
                    // delete是因为实例身上可能已经覆盖了这个属性，而我们重新定义了类的原型，如果不删除，后续无法捕获属性的变化
                    delete target[propertyName];
                    target[propertyName] = oldValue;
                } else if (oldValue) {
                    // 值没有发生变化，将值设置回去，但不计作DIFF
                    if (oldSet) {
                        oldSet(oldValue);
                    } else {
                        let repObj = getReplicateObject(target);
                        repObj.propertyChanged(propertyName, oldValue, true);
                    }
                }
            }
        });

        // 初始化一次就够了
        markObj.init = true;
    }

    return repObj.genDiff(from, to);
}