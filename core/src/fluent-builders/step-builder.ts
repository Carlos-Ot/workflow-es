import { StepBody, InlineStepBody } from "../abstractions";
import { WorkflowDefinition, WorkflowStepBase, WorkflowStep, StepOutcome, StepExecutionContext, ExecutionResult, WorkflowErrorHandling, SagaContainer } from "../models";
import { WaitFor, Foreach, While, If, Delay, Schedule, Sequence } from "../primitives";
import { WorkflowBuilder } from "./workflow-builder";
import { ReturnStepBuilder } from "./return-step-builder";
import { OutcomeBuilder } from "./outcome-builder";
import { ParallelStepBuilder } from "./parallel-step-builder";

export class StepBuilder<TStepBody extends StepBody, TData> {

    private workflowBuilder: WorkflowBuilder<TData>;
    public step: WorkflowStep<TStepBody>;

    constructor(workflowBuilder: WorkflowBuilder<TData>, step: WorkflowStep<TStepBody>) {
        this.workflowBuilder = workflowBuilder;
        this.step = step;
    }

    public name(name: string): StepBuilder<TStepBody, TData> {
        this.step.name = name;
        return this;
    }

    public then<TNewStepBody extends StepBody>(body: { new(): TNewStepBody; }, setup: (step: StepBuilder<TNewStepBody, TData>) => void = null): StepBuilder<TNewStepBody, TData> {
        let newStep = new WorkflowStep<TNewStepBody>();
        newStep.body = body;
        this.workflowBuilder.addStep(newStep);
        let stepBuilder = new StepBuilder<TNewStepBody, TData>(this.workflowBuilder, newStep);

        //setup
        if (setup) {
            setup(stepBuilder);
        }

        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        outcome.value = x => null;
        this.step.outcomes.push(outcome);
                
        return stepBuilder;
    }

    public thenStep<TNewStepBody extends StepBody>(newStep: StepBuilder<TNewStepBody, TData>): StepBuilder<TNewStepBody, TData> {
        let outcome = new StepOutcome();
        outcome.nextStep = newStep.step.id;
        outcome.value = x => null;
        this.step.outcomes.push(outcome);
                
        return newStep;
    }

    public thenRun(step: (context: StepExecutionContext) => Promise<ExecutionResult>): StepBuilder<InlineStepBody, TData> {
        let newStep = new WorkflowStep<InlineStepBody>();
        
        class bodyClass extends InlineStepBody {
            constructor() {
                super(step)
            }
        };
        
        newStep.body = bodyClass;
        this.workflowBuilder.addStep(newStep);
        let stepBuilder = new StepBuilder<InlineStepBody, TData>(this.workflowBuilder, newStep);
        
        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        outcome.value = x => null;
        this.step.outcomes.push(outcome);
                
        return stepBuilder;
    }

    public when(outcomeValue: (data: TData) => any): OutcomeBuilder<TData> {
        let outcome = new StepOutcome();
        outcome.value = outcomeValue;
        this.step.outcomes.push(outcome);
        let outcomeBuilder = new OutcomeBuilder<TData>(this.workflowBuilder, outcome);
        return outcomeBuilder;
    }

    public input(expression: (step: TStepBody, data: TData) => void): StepBuilder<TStepBody, TData> {
        this.step.inputs.push(expression);
        return this;
    }

    public output(expression: (step: TStepBody, data: TData) => void): StepBuilder<TStepBody, TData> {
        this.step.outputs.push(expression);
        return this;
    }

    public waitFor(eventName: string, eventKey: (data: TData) => any, effectiveDate: (data: TData) => Date = x => new Date()): StepBuilder<WaitFor, TData> {
        let newStep = new WorkflowStep<WaitFor>();
        newStep.body = WaitFor;
        newStep.inputs.push((step: WaitFor, data: any) => step.eventName = eventName);
        newStep.inputs.push((step: WaitFor, data: any) => step.eventKey = eventKey(data));
        newStep.inputs.push((step: WaitFor, data: any) => step.effectiveDate = effectiveDate(data));
        this.workflowBuilder.addStep(newStep);
        
        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        this.step.outcomes.push(outcome);

        return new StepBuilder<WaitFor, TData>(this.workflowBuilder, newStep);
    }

    public end<TNewStepBody extends StepBody>(stepName: string): StepBuilder<TNewStepBody, TData> {
        let ancestor: any = this.iterateParents(this.step.id, stepName);

        if (!ancestor)
            throw "Parent step of name " + stepName + " not found";
        
        return new StepBuilder<TNewStepBody, TData>(this.workflowBuilder, ancestor);
    }

    public onError(behavior: number, retryInterval: number = null): StepBuilder<TStepBody, TData> {
        this.step.errorBehavior = behavior;
        this.step.retryInterval = retryInterval;
        return this;
    }

    private iterateParents(id: number, name: string): WorkflowStepBase {
        let upstream = this.workflowBuilder.getUpstreamSteps(id);
        
        for (let parent of upstream) {
            if (parent.name == name)
                return parent;
        }

        for (let parent of upstream) {
            let result = this.iterateParents(parent.id, name);
            if (result)
                return result;
        }

        return null;
    }

    public foreach(expression: (data :TData) => any[]): StepBuilder<Foreach, TData> {
        let newStep = new WorkflowStep<Foreach>();
        newStep.body = Foreach;
        newStep.inputs.push((step: Foreach, data: any) => step.collection = expression(data));
        this.workflowBuilder.addStep(newStep);
        
        let stepBuilder = new StepBuilder<Foreach, TData>(this.workflowBuilder, newStep);

        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        this.step.outcomes.push(outcome);

        return stepBuilder;
    }

    public while(expression: (data :TData) => boolean): StepBuilder<While, TData> {
        let newStep = new WorkflowStep<While>();
        newStep.body = While;
        newStep.inputs.push((step: While, data: any) => step.condition = expression(data));
        this.workflowBuilder.addStep(newStep);
        
        let stepBuilder = new StepBuilder<While, TData>(this.workflowBuilder, newStep);

        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        this.step.outcomes.push(outcome);

        return stepBuilder;
    }

    public if(expression: (data :TData) => boolean): StepBuilder<If, TData> {
        let newStep = new WorkflowStep<If>();
        newStep.body = If;
        newStep.inputs.push((step: If, data: any) => step.condition = expression(data));
        this.workflowBuilder.addStep(newStep);
        
        let stepBuilder = new StepBuilder<If, TData>(this.workflowBuilder, newStep);

        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        this.step.outcomes.push(outcome);

        return stepBuilder;
    }

    public parallel(): ParallelStepBuilder<TData, Sequence> {
        var newStep = new WorkflowStep<Sequence>();
        newStep.body = Sequence;
        this.workflowBuilder.addStep(newStep);
        var newBuilder = new StepBuilder<Sequence, TData>(this.workflowBuilder, newStep);
        let stepBuilder = new ParallelStepBuilder<TData, Sequence>(this.workflowBuilder, newStep, newBuilder);
        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        this.step.outcomes.push(outcome);

        return stepBuilder;
    }

    public saga(builder: (then: WorkflowBuilder<TData>) => void): StepBuilder<Sequence, TData> {
        var newStep = new SagaContainer<Sequence>();
        newStep.body = Sequence;
        this.workflowBuilder.addStep(newStep);
        let stepBuilder = new StepBuilder<Sequence, TData>(this.workflowBuilder, newStep);
        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        this.step.outcomes.push(outcome);
        builder(this.workflowBuilder);
        stepBuilder.step.children.push(stepBuilder.step.id + 1); //TODO: make more elegant

        return stepBuilder;
    }

    public schedule(interval: (data :TData) => number): ReturnStepBuilder<TData, Schedule, TStepBody> {
        let newStep = new WorkflowStep<Schedule>();
        newStep.body = Schedule;
        newStep.inputs.push((step: Schedule, data: any) => step.interval = interval(data));
        this.workflowBuilder.addStep(newStep);
        
        let stepBuilder = new ReturnStepBuilder<TData, Schedule, TStepBody>(this.workflowBuilder, newStep, this);

        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        this.step.outcomes.push(outcome);

        return stepBuilder;
    }

    public delay(milliseconds: (data :TData) => number): StepBuilder<Delay, TData> {
        let newStep = new WorkflowStep<Delay>();
        newStep.body = Delay;
        newStep.inputs.push((step: Delay, data: any) => step.milliseconds = milliseconds(data));
        this.workflowBuilder.addStep(newStep);
        
        let stepBuilder = new StepBuilder<Delay, TData>(this.workflowBuilder, newStep);

        let outcome = new StepOutcome();
        outcome.nextStep = newStep.id;
        this.step.outcomes.push(outcome);

        return stepBuilder;
    }

    public compensateWith<TNewStepBody extends StepBody>(body: { new(): TNewStepBody; }, setup: (step: StepBuilder<TNewStepBody, TData>) => void = null): StepBuilder<TStepBody, TData> {
        let newStep = new WorkflowStep<TNewStepBody>();
        newStep.body = body;
        this.workflowBuilder.addStep(newStep);
        let stepBuilder = new StepBuilder<TNewStepBody, TData>(this.workflowBuilder, newStep);

        //setup
        if (setup) {
            setup(stepBuilder);
        }
        
        this.step.compensationStepId = newStep.id;
                
        return this;
    }

    public compensateWithSequence(sequence: (then: WorkflowBuilder<TData>) => void): StepBuilder<TStepBody, TData> {
        let newStep = new WorkflowStep<Sequence>();
        newStep.body = Sequence;
        this.workflowBuilder.addStep(newStep);
        let stepBuilder = new StepBuilder<Sequence, TData>(this.workflowBuilder, newStep);
        this.step.compensationStepId = newStep.id;
        sequence(this.workflowBuilder);
        stepBuilder.step.children.push(stepBuilder.step.id + 1); //TODO: make more elegant

        return this;
    }

    public do(builder: (then: WorkflowBuilder<TData>) => void): StepBuilder<TStepBody, TData> {
        builder(this.workflowBuilder);
        this.step.children.push(this.step.id + 1); //TODO: make more elegant

        return this;
    }

}